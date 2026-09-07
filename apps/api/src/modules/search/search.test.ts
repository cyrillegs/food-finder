// Mocks every OFF/Search-a-licious HTTP call - these tests never hit the
// real network. The one real call against the live API is done manually as
// part of this module's smoke test, not here.
//
// Also mocks the Prisma client: since Module 3, every /api/search request
// passes through the Subscriptions module's gating middleware
// (subscriptions.gate.ts, applied in shared/app.ts), and since the
// login/multi-user change, that gate (and Recent Searches' logging
// middleware below) resolve "who's asking" via the Auth module's session
// lookup - a session row keyed by a hashed cookie token, then the user row
// it points at - rather than a hardcoded demo id. `prisma.session` and
// `prisma.user` are mocked here so an anonymous request (no cookie) never
// even reaches Prisma, and a request with a cookie resolves to whatever
// this file configures.
//
// Since Module 5, the same request chain also passes through Recent
// Searches' logging middleware (recent-searches.log.ts, also applied in
// shared/app.ts), which calls prisma.recentSearch.findFirst/create/update as
// a fire-and-forget side effect on a successful response for a logged-in
// user. Those methods are mocked here too so that side effect resolves
// instead of throwing against an undefined `prisma.recentSearch` - the
// persistence/ordering/cap/dedup behavior itself is covered in
// recent-searches.test.ts, not duplicated here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../shared/app';

// vi.mock calls are hoisted above the imports above by Vitest, so
// shared/app.ts (and, transitively, shared/prisma.ts) never sees the real
// Prisma client in this file.
const sessionFindUniqueMock = vi.fn();
const userFindUniqueMock = vi.fn();
const recentSearchFindFirstMock = vi.fn();
const recentSearchCreateMock = vi.fn();
const recentSearchUpdateMock = vi.fn();
vi.mock('../../shared/prisma', () => ({
  prisma: {
    session: { findUnique: (...args: unknown[]) => sessionFindUniqueMock(...args) },
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    recentSearch: {
      findFirst: (...args: unknown[]) => recentSearchFindFirstMock(...args),
      create: (...args: unknown[]) => recentSearchCreateMock(...args),
      update: (...args: unknown[]) => recentSearchUpdateMock(...args),
    },
  },
}));

const SESSION_COOKIE = 'ff_session=test-session-token';

// The exact token text is irrelevant - prisma.session.findUnique is mocked
// directly rather than re-deriving a real hash, only that a cookie is
// present or absent matters for the auth middleware's branching.
function mockLoggedInAs(userId: number, subscriptionStatus: string) {
  sessionFindUniqueMock.mockResolvedValue({
    id: 1,
    tokenHash: 'irrelevant-in-tests',
    userId,
    expiresAt: new Date(Date.now() + 60_000),
  });
  userFindUniqueMock.mockResolvedValue({ id: userId, email: `user${userId}@food-finder.local`, subscriptionStatus });
}

function mockOffResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const { ok = true, status = 200 } = init;
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('GET /api/search', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Default: no session cookie sent, matching an anonymous visitor -
    // search stays open per the assignment brief, nutriments just come back
    // locked (see subscriptions.gate.ts).
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns 400 and never calls upstream when the query is missing', async () => {
    const res = await request(app).get('/api/search');

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/query/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the query is blank', async () => {
    const res = await request(app).get('/api/search').query({ q: '   ' });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns normalized results for an anonymous search, nutriments locked, with full product data otherwise', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOffResponse({
        hits: [
          {
            code: '3017620422003',
            product_name: 'Nutella',
            product_name_en: 'Nutella',
            product_name_fr: 'Nutella',
            brands: ['Nutella', 'Ferrero'],
            image_url: 'https://images.openfoodfacts.org/nutella.jpg',
            // OFF did return nutrition data for this product, but this is
            // an anonymous request (no session cookie) - the Subscriptions
            // module's gate should strip this key entirely from the
            // response below, the same as a logged-in-but-unsubscribed
            // user would see. The mirror case (subscribed -> included) is
            // covered in subscriptions.test.ts.
            nutriments: { 'energy-kcal_100g': 539, fat_100g: 30.9 },
          },
        ],
        count: 1,
        page: 1,
        page_size: 24,
        page_count: 1,
      }),
    );

    const res = await request(app).get('/api/search').query({ q: 'nutella', locale: 'en' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      query: 'nutella',
      locale: 'en',
      page: 1,
      pageSize: 24,
      totalCount: 1,
      totalPages: 1,
    });
    expect(res.body.results[0]).not.toHaveProperty('nutriments');
    expect(res.body.subscriptionActive).toBe(false);
    expect(res.body.results).toEqual([
      {
        code: '3017620422003',
        name: 'Nutella',
        brand: 'Nutella, Ferrero',
        imageUrl: 'https://images.openfoodfacts.org/nutella.jpg',
      },
    ]);

    // Confirms we're calling the correct endpoint (Search-a-licious, not
    // OFF's v2/search or the legacy cgi endpoint) with the right params.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.origin + requestedUrl.pathname).toBe('https://search.openfoodfacts.org/search');
    expect(requestedUrl.searchParams.get('q')).toBe('nutella');
    expect(requestedUrl.searchParams.get('langs')).toBe('en');

    // An anonymous search - no session cookie above - never gets logged:
    // there's no User row to attach it to. Full logged-in
    // persistence/ordering/cap/dedup coverage lives in
    // recent-searches.test.ts; this just confirms the anonymous case is a
    // true no-op here.
    expect(recentSearchCreateMock).not.toHaveBeenCalled();

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(requestInit.headers).toMatchObject({
      'User-Agent': expect.stringContaining('FoodFinder'),
    });
  });

  it('locks nutriments for a logged-in user whose subscription is not active, same as an anonymous request', async () => {
    mockLoggedInAs(1, 'inactive');
    fetchMock.mockResolvedValueOnce(
      mockOffResponse({
        hits: [{ code: '3017620422003', product_name: 'Nutella', nutriments: { 'energy-kcal_100g': 539 } }],
        count: 1,
        page: 1,
        page_size: 24,
        page_count: 1,
      }),
    );

    const res = await request(app).get('/api/search').query({ q: 'nutella', locale: 'en' }).set('Cookie', SESSION_COOKIE);

    expect(res.status).toBe(200);
    expect(res.body.results[0]).not.toHaveProperty('nutriments');
    expect(res.body.subscriptionActive).toBe(false);

    // Unlike an anonymous search, a logged-in user's search IS recorded,
    // even though their subscription isn't active - Recent Searches and
    // Subscriptions gate independently.
    expect(recentSearchCreateMock).toHaveBeenCalledWith({ data: { userId: 1, query: 'nutella' } });
  });

  it('falls back to another available language when the requested locale has no translation', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOffResponse({
        hits: [
          {
            code: '1234567890123',
            product_name: 'Mousse au chocolat',
            product_name_de: 'Mousse au chocolat',
            // no product_name_fr and no product_name_en on this product
          },
        ],
        count: 1,
        page: 1,
        page_size: 24,
        page_count: 1,
      }),
    );

    const res = await request(app).get('/api/search').query({ q: 'mousse', locale: 'fr' });

    expect(res.status).toBe(200);
    expect(res.body.results[0].name).toBe('Mousse au chocolat');
  });

  it('normalizes missing brand/image/name fields to null rather than throwing', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOffResponse({
        hits: [{ code: '000111222333' }],
        count: 1,
        page: 1,
        page_size: 24,
        page_count: 1,
      }),
    );

    const res = await request(app).get('/api/search').query({ q: 'mystery', locale: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.results[0]).toEqual({
      code: '000111222333',
      name: null,
      brand: null,
      imageUrl: null,
    });
  });

  it('skips hits with no product code rather than surfacing a broken card', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOffResponse({
        hits: [{ product_name: 'No barcode' }, { code: '999', product_name: 'Has barcode' }],
        count: 2,
        page: 1,
        page_size: 24,
        page_count: 1,
      }),
    );

    const res = await request(app).get('/api/search').query({ q: 'test', locale: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].code).toBe('999');
  });

  it('returns an empty result set for zero matches', async () => {
    fetchMock.mockResolvedValueOnce(mockOffResponse({ hits: [], count: 0, page: 1, page_size: 24, page_count: 0 }));

    const res = await request(app).get('/api/search').query({ q: 'zzzznonexistent', locale: 'en' });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.totalCount).toBe(0);
  });

  it('returns 502 when the upstream service responds with an error status', async () => {
    fetchMock.mockResolvedValueOnce(mockOffResponse({ detail: 'boom' }, { ok: false, status: 500 }));

    const res = await request(app).get('/api/search').query({ q: 'nutella', locale: 'en' });

    expect(res.status).toBe(502);
    expect(res.body.error.message).toBeTruthy();
  });

  it('returns 504 when the upstream request times out', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    fetchMock.mockRejectedValueOnce(abortError);

    const res = await request(app).get('/api/search').query({ q: 'nutella', locale: 'en' });

    expect(res.status).toBe(504);
  });

  it('returns 502 when the upstream request fails for a non-timeout reason', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));

    const res = await request(app).get('/api/search').query({ q: 'nutella', locale: 'en' });

    expect(res.status).toBe(502);
  });
});
