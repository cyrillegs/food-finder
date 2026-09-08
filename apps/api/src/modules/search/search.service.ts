// Client for Search-a-licious (https://search.openfoodfacts.org), the
// service that actually implements filtered Open Food Facts search.
//
// Do NOT swap this for OFF's own /api/v2/search or the legacy
// /cgi/search.pl - both were verified live during planning to ignore
// `search_terms` (v2 silently returns an unfiltered slice of the ~4.7M
// product database; the legacy endpoint just 404s/"temporarily
// unavailable"s). Search-a-licious's `/search` with `q=` is the endpoint
// that actually filters.
//
// Verified live against the service's current /openapi.json and sample
// requests while building this module (2026-09):
//   - GET /search takes `q`, `langs`, `page`, `page_size`, `fields` as plain
//     query params. `langs` is a single query param whose value is a
//     comma-separated list (e.g. `langs=en,fr`), not a repeated param.
//   - The response's `product_name` field does NOT change based on `langs` -
//     it stays whatever the product's own primary language is. `langs` only
//     affects which per-language subfields are *matched against* for the
//     query text. To actually localize the displayed name we have to
//     request the per-language fields directly and pick one ourselves - see
//     resolveName() below.
//   - Per-language fields use an underscore, not a dot: `product_name_fr`,
//     not `product_name.fr`. (The dotted form appears in the service's
//     internal query DSL for matching, e.g. `product_name.fr` inside the
//     `debug.query` block - that's a different thing from the field name
//     used for `fields=`/response keys.)
//   - Fields absent on a product are omitted from the hit entirely (not
//     returned as null), so all field reads below are optional-chained /
//     type-guarded rather than compared to null.
import {
  SUPPORTED_LOCALES,
  type OffSearchHit,
  type OffSearchResponse,
  type SearchProduct,
  type SupportedLocale,
} from './search.types';

const OFF_SEARCH_URL = 'https://search.openfoodfacts.org/search';

// Open Food Facts' API usage policy expects a descriptive User-Agent on all
// requests.
const USER_AGENT = 'FoodFinder/0.1 (https://github.com/cyrillegs/food-finder)';

const REQUEST_TIMEOUT_MS = 7000;

// Only request the fields this module (and the normalization fallback logic
// below) actually needs. `nutriments` is requested and passed through
// unmodified in the normalized product (see normalizeProduct below) - the
// Subscriptions module is responsible for stripping it back out of the
// Search route's response when the demo user isn't subscribed, not this
// module.
const REQUESTED_FIELDS = [
  'code',
  'product_name',
  ...SUPPORTED_LOCALES.map((locale) => `product_name_${locale}`),
  'brands',
  'image_url',
  'nutriments',
].join(',');

export class SearchUpstreamError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'SearchUpstreamError';
    this.status = status;
  }
}

export interface SearchParams {
  query: string;
  locale: SupportedLocale;
  page: number;
  pageSize: number;
}

export interface SearchResult {
  results: SearchProduct[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export async function searchProducts({ query, locale, page, pageSize }: SearchParams): Promise<SearchResult> {
  const url = new URL(OFF_SEARCH_URL);
  url.searchParams.set('q', query);
  // Always search English alongside the requested locale: most products are
  // only ever indexed in English regardless of the shopper's own language,
  // so restricting matching to just the requested locale would silently
  // drop otherwise-relevant results.
  url.searchParams.set('langs', Array.from(new Set([locale, 'en'])).join(','));
  url.searchParams.set('page', String(page));
  url.searchParams.set('page_size', String(pageSize));
  url.searchParams.set('fields', REQUESTED_FIELDS);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let data: OffSearchResponse;
  // The timeout deliberately stays armed until the body is fully read, not
  // just until headers arrive. Clearing it after `fetch` resolves would
  // leave `response.json()` with no deadline at all - and a server that
  // sends headers promptly then stalls mid-body would hang this Express
  // request forever rather than producing the 504 this is here to produce.
  // Not hypothetical for this upstream: Open Food Facts' hosts have been
  // observed timing out at the connection level for tens of seconds.
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SearchUpstreamError('Search request to Open Food Facts timed out.', 504);
      }
      throw new SearchUpstreamError('Failed to reach the Open Food Facts search service.', 502);
    }

    if (!response.ok) {
      throw new SearchUpstreamError(`Open Food Facts search service responded with status ${response.status}.`, 502);
    }

    try {
      data = (await response.json()) as OffSearchResponse;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SearchUpstreamError('Search request to Open Food Facts timed out.', 504);
      }
      throw new SearchUpstreamError('Received an invalid response from the Open Food Facts search service.', 502);
    }
  } finally {
    clearTimeout(timeoutId);
  }

  const results = (data.hits ?? [])
    .map((hit) => normalizeProduct(hit, locale))
    .filter((product): product is SearchProduct => product !== null);

  return {
    results,
    page: data.page ?? page,
    pageSize: data.page_size ?? pageSize,
    totalCount: data.count ?? results.length,
    totalPages: data.page_count ?? (results.length > 0 ? 1 : 0),
  };
}

// Picks the best available product name for `locale`, falling back through
// other languages rather than ever showing a blank name: requested locale ->
// English (the most commonly populated language on OFF) -> any other
// supported locale -> the untranslated generic `product_name`. Returns null
// only if none of those fields are present at all.
function resolveName(hit: OffSearchHit, locale: SupportedLocale): string | null {
  const namesByLocale: Record<SupportedLocale, string | undefined> = {
    en: hit.product_name_en,
    nl: hit.product_name_nl,
    de: hit.product_name_de,
    fr: hit.product_name_fr,
  };

  const fallbackOrder: SupportedLocale[] = [
    locale,
    'en',
    ...SUPPORTED_LOCALES.filter((candidate) => candidate !== locale && candidate !== 'en'),
  ];

  for (const candidate of fallbackOrder) {
    const value = namesByLocale[candidate];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  if (typeof hit.product_name === 'string' && hit.product_name.trim().length > 0) {
    return hit.product_name.trim();
  }

  return null;
}

function resolveBrand(hit: OffSearchHit): string | null {
  if (Array.isArray(hit.brands)) {
    const names = hit.brands.map((brand) => brand.trim()).filter((brand) => brand.length > 0);
    return names.length > 0 ? names.join(', ') : null;
  }

  if (typeof hit.brands === 'string' && hit.brands.trim().length > 0) {
    return hit.brands.trim();
  }

  return null;
}

function normalizeProduct(hit: OffSearchHit, locale: SupportedLocale): SearchProduct | null {
  if (!hit || typeof hit.code !== 'string' || hit.code.trim().length === 0) {
    // A hit without a barcode can't be linked to a product page later on -
    // skip it rather than surfacing a card with no identity.
    return null;
  }

  const nutriments =
    hit.nutriments && typeof hit.nutriments === 'object' && !Array.isArray(hit.nutriments) ? hit.nutriments : undefined;

  return {
    code: hit.code,
    name: resolveName(hit, locale),
    brand: resolveBrand(hit),
    imageUrl: typeof hit.image_url === 'string' && hit.image_url.trim().length > 0 ? hit.image_url : null,
    // Spread conditionally rather than always assigning `nutriments:
    // undefined` so the key is omitted entirely when OFF didn't return any -
    // consistent with how gating removes it later (present-with-data or
    // absent, never present-but-null).
    ...(nutriments ? { nutriments } : {}),
  };
}
