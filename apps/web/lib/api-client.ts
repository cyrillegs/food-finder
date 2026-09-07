// Thin client for talking to @food-finder/api. Per-module functions get added
// here as those modules land.

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
    // Search itself stays open/anonymous, but `credentials: 'include'` is
    // still needed here: a logged-in visitor's session cookie is what lets
    // the API's nutriments gate tell "logged in and subscribed" apart from
    // "anonymous" (see apps/api's subscriptions.gate.ts) - without it, a
    // subscribed user would see locked nutriments on every search.
    response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'include' });
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

// Creates a Stripe Checkout Session for the logged-in user and returns its
// hosted URL. Callers redirect the browser there directly
// (window.location.href = url) - see components/subscriptions/SubscribeButton.tsx.
// Requires a logged-in user (the API 401s otherwise - see
// apps/api/src/modules/subscriptions/subscriptions.route.ts), hence
// `credentials: 'include'` to actually send the session cookie.
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
      credentials: 'include',
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

// Mirrors apps/api/src/modules/recent-searches/recent-searches.route.ts's
// response shape.
export interface RecentSearchEntry {
  id: number;
  query: string;
  createdAt: string;
}

export class RecentSearchesRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'RecentSearchesRequestError';
    this.status = status;
  }
}

// Fetches the logged-in user's most recent searches, newest first, already
// capped at 10 by the API (see recent-searches.service.ts) - nothing further
// to cap or sort here. Requires a logged-in user (the API 401s otherwise) -
// callers should only invoke this when a user is known to be logged in (see
// SearchExperience.tsx), hence `credentials: 'include'` to send the session
// cookie.
export async function getRecentSearches(): Promise<RecentSearchEntry[]> {
  if (!API_BASE_URL) {
    throw new RecentSearchesRequestError('NEXT_PUBLIC_API_BASE_URL is not configured.');
  }

  const url = new URL('/api/searches/recent', API_BASE_URL);

  let response: globalThis.Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'include' });
  } catch {
    throw new RecentSearchesRequestError('Could not reach the recent searches service.');
  }

  if (!response.ok) {
    const body: { error?: { message?: string } } | null = await response.json().catch(() => null);
    throw new RecentSearchesRequestError(body?.error?.message ?? 'Failed to load recent searches.', response.status);
  }

  const data = (await response.json()) as { results: RecentSearchEntry[] };
  return data.results;
}

// Deletes one recent-search entry, scoped server-side to the logged-in
// user (see recent-searches.route.ts) - this never needs to pass a user id
// itself, the session cookie is what authorizes it.
export async function deleteRecentSearch(id: number): Promise<void> {
  if (!API_BASE_URL) {
    throw new RecentSearchesRequestError('NEXT_PUBLIC_API_BASE_URL is not configured.');
  }

  const url = new URL(`/api/searches/recent/${id}`, API_BASE_URL);

  let response: globalThis.Response;
  try {
    response = await fetch(url, { method: 'DELETE', credentials: 'include' });
  } catch {
    throw new RecentSearchesRequestError('Could not reach the recent searches service.');
  }

  if (!response.ok) {
    const body: { error?: { message?: string } } | null = await response.json().catch(() => null);
    throw new RecentSearchesRequestError(body?.error?.message ?? 'Failed to delete recent search.', response.status);
  }
}

// Mirrors apps/api/src/modules/auth/auth.service.ts's PublicUser - never
// includes passwordHash or Stripe ids, only what the frontend needs to
// reflect auth state and gate the Subscribe UI.
export interface CurrentUser {
  id: number;
  email: string;
  subscriptionStatus: string;
}

export class AuthRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AuthRequestError';
    this.status = status;
  }
}

// Verifies credentials and, on success, establishes a session (the API sets
// an httpOnly cookie on the response - nothing for this function to persist
// itself). Throws AuthRequestError with a generic message on any failure;
// the API deliberately never distinguishes "wrong password" from "unknown
// email" in its response, so neither does this.
export async function login(email: string, password: string): Promise<CurrentUser> {
  if (!API_BASE_URL) {
    throw new AuthRequestError('NEXT_PUBLIC_API_BASE_URL is not configured.');
  }

  const url = new URL('/api/auth/login', API_BASE_URL);

  let response: globalThis.Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new AuthRequestError('Could not reach the login service.');
  }

  if (!response.ok) {
    const body: { error?: { message?: string } } | null = await response.json().catch(() => null);
    throw new AuthRequestError(body?.error?.message ?? 'Login failed.', response.status);
  }

  const data = (await response.json()) as { user: CurrentUser };
  return data.user;
}

// Ends the current session server-side (deletes the Session row and clears
// the cookie). Always "succeeds" from the caller's perspective the same way
// the API's own /logout does - there's nothing meaningful to do differently
// if it fails, so this never throws; a network failure just means the
// cookie may still be around until it expires on its own.
export async function logout(): Promise<void> {
  if (!API_BASE_URL) {
    return;
  }

  const url = new URL('/api/auth/logout', API_BASE_URL);
  try {
    await fetch(url, { method: 'POST', headers: { Accept: 'application/json' }, credentials: 'include' });
  } catch {
    // Best-effort - see comment above.
  }
}

// Resolves the current session, if any. Returns null for "not logged in"
// (a 401 from the API) rather than throwing - that's an expected, common
// state (every anonymous visitor starts this way), not an error condition.
// Only a genuine failure (network error, unexpected server error) throws.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!API_BASE_URL) {
    throw new AuthRequestError('NEXT_PUBLIC_API_BASE_URL is not configured.');
  }

  const url = new URL('/api/auth/me', API_BASE_URL);

  let response: globalThis.Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'include' });
  } catch {
    throw new AuthRequestError('Could not reach the auth service.');
  }

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    const body: { error?: { message?: string } } | null = await response.json().catch(() => null);
    throw new AuthRequestError(body?.error?.message ?? 'Failed to load the current user.', response.status);
  }

  const data = (await response.json()) as { user: CurrentUser };
  return data.user;
}
