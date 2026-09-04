// Thin client for talking to @food-finder/api. Per-module functions get added
// here as those modules land, e.g.:
//   export function getRecentSearches() { ... }                // Module 4
//   export function createCheckoutSession() { ... }            // Module 2

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

// Mirrors apps/api/src/modules/search/search.types.ts. Kept as a plain
// duplicate rather than a shared package since the two apps don't otherwise
// share types - if that changes later it's an easy extraction.
export interface SearchProduct {
  code: string;
  name: string | null;
  brand: string | null;
  imageUrl: string | null;
}

export interface SearchResponse {
  query: string;
  locale: string;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  results: SearchProduct[];
}

export class SearchRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SearchRequestError';
    this.status = status;
  }
}

export async function search(query: string, locale: string, page = 1): Promise<SearchResponse> {
  if (!API_BASE_URL) {
    throw new SearchRequestError('NEXT_PUBLIC_API_BASE_URL is not configured.');
  }

  const url = new URL('/api/search', API_BASE_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('locale', locale);
  url.searchParams.set('page', String(page));

  let response: globalThis.Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new SearchRequestError('Could not reach the search service.');
  }

  if (!response.ok) {
    const body: { error?: { message?: string } } | null = await response.json().catch(() => null);
    throw new SearchRequestError(body?.error?.message ?? 'Search request failed.', response.status);
  }

  return (await response.json()) as SearchResponse;
}
