// Locales the frontend already routes on (see apps/web/i18n/routing.ts). The
// search endpoint accepts any of these via `?locale=`; anything else falls
// back to English.
export const SUPPORTED_LOCALES = ['en', 'nl', 'de', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

// Normalized product shape this module exposes to the frontend. `code` is
// the only field guaranteed to be present - everything else is defensively
// nullable because Open Food Facts product data is community-submitted and
// frequently incomplete.
export interface SearchProduct {
  code: string;
  name: string | null;
  brand: string | null;
  imageUrl: string | null;
  // Present only when Open Food Facts returned nutrition data for this
  // product. Shape is intentionally loose - OFF's nutriments object has
  // dozens of possible keys (`energy-kcal_100g`, `fat_100g`, `sugars_100g`,
  // ...) that vary per product, and this module just passes it through
  // rather than interpreting it. The Subscriptions module strips this key
  // entirely (not just to null) from every result unless the demo user's
  // subscription is active - see
  // modules/subscriptions/subscriptions.gate.ts. Search itself has no
  // gating logic of its own.
  nutriments?: Record<string, unknown>;
}

export interface SearchResponseBody {
  query: string;
  locale: SupportedLocale;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  results: SearchProduct[];
}

export interface SearchErrorResponseBody {
  error: {
    message: string;
  };
}

// Raw shapes returned by Search-a-licious (https://search.openfoodfacts.org),
// scoped to only the fields this module requests via `fields=`. Verified live
// against the service's own /openapi.json and sample queries while building
// this module - see search.service.ts for details on what was confirmed.
//
// Note the response's per-language fields use an underscore convention
// (`product_name_en`, `product_name_fr`, ...), not the dotted
// `product_name.en` form used internally by Search-a-licious's own query
// builder for matching - the two are easy to conflate but are not the same
// thing.
export interface OffSearchHit {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  product_name_nl?: string;
  product_name_de?: string;
  product_name_fr?: string;
  // Observed as an array of brand names in every live sample checked; a
  // plain string is handled defensively in case a product record has an
  // unnormalized value.
  brands?: string[] | string;
  image_url?: string;
  // Free-form per-product nutrition data - see SearchProduct.nutriments.
  nutriments?: Record<string, unknown>;
}

export interface OffSearchResponse {
  hits: OffSearchHit[];
  count: number;
  page: number;
  page_size: number;
  page_count: number;
  is_count_exact?: boolean;
}
