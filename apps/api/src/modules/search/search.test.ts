// Mocks every OFF/Search-a-licious HTTP call - these tests never hit the
// real network. The one real call against the live API is done manually as
// part of this module's smoke test, not here.
//
// Also mocks the Prisma client: since Module 3, every /api/search request
// passes through the Subscriptions module's gating middleware
// (subscriptions.gate.ts, applied in shared/app.ts), which looks up
// DemoUser.subscriptionStatus before the Search route ever runs. Mocking
// Prisma here is the equivalent, for that dependency, of mocking `fetch` for
// the OFF dependency above - neither should hit real infrastructure in this
// suite. The "subscription active -> nutriments included" case lives in
// subscriptions.test.ts instead, alongside the rest of that module's gating
// coverage, rather than being duplicated here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../shared/app';

// vi.mock calls are hoisted above the imports above by Vitest, so
// shared/app.ts (and, transitively, shared/prisma.ts) never sees the real
// Prisma client in this file.
const findUniqueMock = vi.fn();
vi.mock('../../shared/prisma', () => ({
  prisma: { demoUser: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
}));

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
    // Default: demo user isn't subscribed, matching this app's normal state.
    findUniqueMock.mockResolvedValue({ id: 1, subscriptionStatus: 'inactive' });
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

  it('returns normalized results for a successful search with full product data', async () => {
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
            // OFF did return nutrition data for this product, but the demo
            // user isn't subscribed (see beforeEach) - the Subscriptions
            // module's gate should strip this key entirely from the
            // response below. The mirror case (subscribed -> included) is
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

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(requestInit.headers).toMatchObject({
      'User-Agent': expect.stringContaining('FoodFinder'),
    });
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
