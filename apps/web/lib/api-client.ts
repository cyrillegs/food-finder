// Thin client for talking to @food-finder/api. Per-module functions get added
// here as those modules land, e.g.:
//   export function getRecentSearches() { ... }                // Module 4

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

// Mirrors apps/api/src/modules/search/search.types.ts. Kept as a plain
// duplicate rather than a shared package since the two apps don't otherwise
// share types - if that changes later it's an easy extraction.
export interface SearchProduct {
  code: string;
  name: string | null;
  brand: string | null;
  imageUrl: string | null;
  // Present only when the demo user's subscription is active - the API
  // omits this key entirely otherwise (see
  // apps/api/src/modules/subscriptions/subscriptions.gate.ts). Shape is
  // intentionally loose, matching the API's own SearchProduct.nutriments.
  nutriments?: Record<string, unknown>;
}

export interface SearchResponse {
  query: string;
  locale: string;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  results: SearchProduct[];
  // Whether the demo user's subscription is currently active - distinct from
  // whether any given product happens to have `nutriments`. A subscribed
  // user searching for a product Open Food Facts has no nutrition data for
  // at all still has an active subscription; the UI needs this flag to tell
  // that case apart from "not subscribed", since both look identical if you
  // only check for the presence of `nutriments` on a product.
  subscriptionActive: boolean;
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

export class CheckoutSessionRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'CheckoutSessionRequestError';
    this.status = status;
  }
}

// Creates a Stripe Checkout Session for the demo user and returns its hosted
// URL. Callers redirect the browser there directly
// (window.location.href = url) - see components/subscriptions/SubscribeButton.tsx.
export async function createCheckoutSession(locale: string): Promise<string> {
  if (!API_BASE_URL) {
    throw new CheckoutSessionRequestError('NEXT_PUBLIC_API_BASE_URL is not configured.');
  }

  const url = new URL('/api/subscriptions/checkout-session', API_BASE_URL);

  let response: globalThis.Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ locale }),
    });
  } catch {
    throw new CheckoutSessionRequestError('Could not reach the subscriptions service.');
  }

  if (!response.ok) {
    const body: { error?: { message?: string } } | null = await response.json().catch(() => null);
    throw new CheckoutSessionRequestError(body?.error?.message ?? 'Failed to start checkout.', response.status);
  }

  const data = (await response.json()) as { url: string };
  return data.url;
}
