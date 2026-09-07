// Mocks Prisma directly (`prisma.recentSearch.*`) for the service-level
// tests below - same convention as search.test.ts/subscriptions.test.ts:
// never touch a real database in this suite. `prisma.user.findUnique` and
// `prisma.session.findUnique` are also mocked: every /api/search request
// passes through the Subscriptions module's gating middleware AND this
// module's own logging middleware (see search.test.ts's own comment on the
// former), both of which now resolve "who's asking" via the Auth module's
// session-cookie lookup (session row -> user row) rather than a hardcoded
// id - so both models need to be mockable even in tests that are really
// about recent-searches persistence.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../shared/app';
import { recordSearch, getRecentSearches, deleteRecentSearch } from './recent-searches.service';

// vi.mock calls are hoisted above the imports above by Vitest, so
// shared/app.ts (and, transitively, shared/prisma.ts) never sees the real
// Prisma client in this file. The inner arrow functions close over these
// vi.fn()s by reference rather than reading them at factory-definition
// time, so the const declarations below are safe to keep simple (same
// pattern as search.test.ts).
const sessionFindUniqueMock = vi.fn();
const userFindUniqueMock = vi.fn();
const recentSearchMocks = {
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
};

vi.mock('../../shared/prisma', () => ({
  prisma: {
    session: { findUnique: (...args: unknown[]) => sessionFindUniqueMock(...args) },
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    recentSearch: {
      findFirst: (...args: unknown[]) => recentSearchMocks.findFirst(...args),
      findMany: (...args: unknown[]) => recentSearchMocks.findMany(...args),
      create: (...args: unknown[]) => recentSearchMocks.create(...args),
      update: (...args: unknown[]) => recentSearchMocks.update(...args),
      deleteMany: (...args: unknown[]) => recentSearchMocks.deleteMany(...args),
    },
  },
}));

// A fixed session cookie value used across this suite - the exact token
// text is irrelevant since prisma.session.findUnique is mocked directly
// (it doesn't actually re-derive/compare a real hash), only that a cookie
// is present or absent at all, matching what the auth middleware branches
// on for "logged in vs anonymous".
const SESSION_COOKIE = 'ff_session=test-session-token';

function mockLoggedInAs(userId: number, overrides: Record<string, unknown> = {}) {
  sessionFindUniqueMock.mockResolvedValue({
    id: 1,
    tokenHash: 'irrelevant-in-tests',
    userId,
    expiresAt: new Date(Date.now() + 60_000),
  });
  userFindUniqueMock.mockResolvedValue({
    id: userId,
    email: `user${userId}@food-finder.local`,
    subscriptionStatus: 'inactive',
    ...overrides,
  });
}

function row(id: number, userId: number, query: string, createdAt: Date) {
  return { id, userId, query, createdAt };
}

describe('recent-searches.service', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('recordSearch', () => {
    it('creates a new row when there is no existing history', async () => {
      recentSearchMocks.findFirst.mockResolvedValue(null);

      await recordSearch(1, 'nutella');

      expect(recentSearchMocks.create).toHaveBeenCalledWith({
        data: { userId: 1, query: 'nutella' },
      });
      expect(recentSearchMocks.update).not.toHaveBeenCalled();
    });

    it('creates a new row when the most recent query differs', async () => {
      recentSearchMocks.findFirst.mockResolvedValue(row(1, 1, 'chocolate', new Date('2026-01-01T00:00:00Z')));

      await recordSearch(1, 'nutella');

      expect(recentSearchMocks.create).toHaveBeenCalledWith({
        data: { userId: 1, query: 'nutella' },
      });
      expect(recentSearchMocks.update).not.toHaveBeenCalled();
    });

    // The core dedup decision: an immediate repeat of the most-recently-
    // logged query (searching "nutella" twice in a row, or clicking a recent
    // entry that's already the top one) bumps that row's timestamp instead
    // of inserting a duplicate - so the panel never fills up with copies of
    // the same query back-to-back.
    it('bumps the existing row instead of creating a duplicate when the query repeats immediately', async () => {
      recentSearchMocks.findFirst.mockResolvedValue(row(7, 1, 'nutella', new Date('2026-01-01T00:00:00Z')));

      await recordSearch(1, 'nutella');

      expect(recentSearchMocks.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { createdAt: expect.any(Date) },
      });
      expect(recentSearchMocks.create).not.toHaveBeenCalled();
    });

    it('trims incoming whitespace before comparing/storing', async () => {
      recentSearchMocks.findFirst.mockResolvedValue(row(7, 1, 'nutella', new Date('2026-01-01T00:00:00Z')));

      await recordSearch(1, '  nutella  ');

      expect(recentSearchMocks.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { createdAt: expect.any(Date) },
      });
      expect(recentSearchMocks.create).not.toHaveBeenCalled();
    });

    it('does nothing for a blank query', async () => {
      await recordSearch(1, '   ');

      expect(recentSearchMocks.findFirst).not.toHaveBeenCalled();
      expect(recentSearchMocks.create).not.toHaveBeenCalled();
      expect(recentSearchMocks.update).not.toHaveBeenCalled();
    });

    it('scopes the lookup to the given user id, not any other user', async () => {
      recentSearchMocks.findFirst.mockResolvedValue(null);

      await recordSearch(42, 'nutella');

      expect(recentSearchMocks.findFirst).toHaveBeenCalledWith({
        where: { userId: 42 },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getRecentSearches', () => {
    it('queries newest-first, capped at 10, scoped to the given user', async () => {
      recentSearchMocks.findMany.mockResolvedValue([]);

      await getRecentSearches(1);

      expect(recentSearchMocks.findMany).toHaveBeenCalledWith({
        where: { userId: 1 },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });

    it('returns whatever Prisma hands back, newest first', async () => {
      const rows = [row(3, 1, 'chocolate', new Date('2026-01-03T00:00:00Z')), row(2, 1, 'nutella', new Date('2026-01-02T00:00:00Z'))];
      recentSearchMocks.findMany.mockResolvedValue(rows);

      const result = await getRecentSearches(1);

      expect(result).toBe(rows);
    });
  });

  describe('deleteRecentSearch', () => {
    it('scopes the delete to both the search id and the given user id', async () => {
      recentSearchMocks.deleteMany.mockResolvedValue({ count: 1 });

      await deleteRecentSearch(1, 7);

      expect(recentSearchMocks.deleteMany).toHaveBeenCalledWith({
        where: { id: 7, userId: 1 },
      });
    });

    it('returns true when a row was actually deleted', async () => {
      recentSearchMocks.deleteMany.mockResolvedValue({ count: 1 });

      const result = await deleteRecentSearch(1, 7);

      expect(result).toBe(true);
    });

    // Covers both "no such id at all" and "id belongs to another user" -
    // deleteMany's count is 0 either way, which is exactly what should map
    // to "not deleted" without distinguishing the two cases.
    it("returns false when nothing matched (unknown id, or someone else's id)", async () => {
      recentSearchMocks.deleteMany.mockResolvedValue({ count: 0 });

      const result = await deleteRecentSearch(1, 999);

      expect(result).toBe(false);
    });
  });
});

describe('GET /api/searches/recent', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('requires a logged-in user - 401 with no session cookie', async () => {
    const res = await request(app).get('/api/searches/recent');

    expect(res.status).toBe(401);
    expect(recentSearchMocks.findMany).not.toHaveBeenCalled();
  });

  it('returns the capped, newest-first list as ISO timestamps, scoped to the logged-in user', async () => {
    mockLoggedInAs(1);
    recentSearchMocks.findMany.mockResolvedValue([
      row(2, 1, 'nutella', new Date('2026-01-02T00:00:00.000Z')),
      row(1, 1, 'chocolate', new Date('2026-01-01T00:00:00.000Z')),
    ]);

    const res = await request(app).get('/api/searches/recent').set('Cookie', SESSION_COOKIE);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      results: [
        { id: 2, query: 'nutella', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 1, query: 'chocolate', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
    expect(recentSearchMocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 1 } }));
  });

  it('returns an empty list when the logged-in user has no history', async () => {
    mockLoggedInAs(1);
    recentSearchMocks.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/searches/recent').set('Cookie', SESSION_COOKIE);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [] });
  });

  // The actual point of this whole module's migration: two different
  // logged-in users must never see each other's history. This is a service-
  // level proof (the query is scoped by whichever userId the session
  // resolves to) rather than a real-database proof - that's covered
  // separately by manual/e2e verification against a real DB.
  it("scopes the query to whichever user's session is presented, not a fixed id", async () => {
    mockLoggedInAs(2);
    recentSearchMocks.findMany.mockResolvedValue([row(9, 2, 'oat milk', new Date('2026-01-05T00:00:00.000Z'))]);

    const res = await request(app).get('/api/searches/recent').set('Cookie', SESSION_COOKIE);

    expect(res.status).toBe(200);
    expect(recentSearchMocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 2 } }));
    expect(res.body.results).toEqual([{ id: 9, query: 'oat milk', createdAt: '2026-01-05T00:00:00.000Z' }]);
  });
});

describe('DELETE /api/searches/recent/:id', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('requires a logged-in user - 401 with no session cookie', async () => {
    const res = await request(app).delete('/api/searches/recent/7');

    expect(res.status).toBe(401);
    expect(recentSearchMocks.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes the entry and responds 204 when it belongs to the logged-in user', async () => {
    mockLoggedInAs(1);
    recentSearchMocks.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(app).delete('/api/searches/recent/7').set('Cookie', SESSION_COOKIE);

    expect(res.status).toBe(204);
    expect(recentSearchMocks.deleteMany).toHaveBeenCalledWith({ where: { id: 7, userId: 1 } });
  });

  it("responds 404 for an id that belongs to a different user, without revealing that it exists", async () => {
    mockLoggedInAs(1);
    recentSearchMocks.deleteMany.mockResolvedValue({ count: 0 });

    const res = await request(app).delete('/api/searches/recent/7').set('Cookie', SESSION_COOKIE);

    expect(res.status).toBe(404);
    expect(recentSearchMocks.deleteMany).toHaveBeenCalledWith({ where: { id: 7, userId: 1 } });
  });

  it('responds 404 for an id that does not exist at all', async () => {
    mockLoggedInAs(1);
    recentSearchMocks.deleteMany.mockResolvedValue({ count: 0 });

    const res = await request(app).delete('/api/searches/recent/999999').set('Cookie', SESSION_COOKIE);

    expect(res.status).toBe(404);
  });

  it('responds 400 for a non-numeric id', async () => {
    mockLoggedInAs(1);

    const res = await request(app).delete('/api/searches/recent/not-a-number').set('Cookie', SESSION_COOKIE);

    expect(res.status).toBe(400);
    expect(recentSearchMocks.deleteMany).not.toHaveBeenCalled();
  });
});

// Integration coverage for the logging hook (recent-searches.log.ts), wired
// into shared/app.ts in front of searchRouter. Mocks `fetch` the same way
// search.test.ts does - these requests never hit the real Open Food Facts
// service.
describe('recording via GET /api/search', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    recentSearchMocks.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function mockOffResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    const { ok = true, status = 200 } = init;
    return { ok, status, json: async () => body } as Response;
  }

  it('records a successful search under the logged-in user', async () => {
    mockLoggedInAs(1);
    fetchMock.mockResolvedValueOnce(
      mockOffResponse({
        hits: [{ code: '3017620422003', product_name: 'Nutella' }],
        count: 1,
        page: 1,
        page_size: 24,
        page_count: 1,
      }),
    );

    const res = await request(app).get('/api/search').query({ q: 'nutella', locale: 'en' }).set('Cookie', SESSION_COOKIE);
    expect(res.status).toBe(200);

    // The middleware awaits the record write before the response is
    // actually sent (see recent-searches.log.ts), so by the time supertest
    // resolves above, this has already happened - no extra tick needed.
    expect(recentSearchMocks.create).toHaveBeenCalledWith({ data: { userId: 1, query: 'nutella' } });
  });

  it('does NOT record an anonymous search - there is no session cookie to resolve a user from', async () => {
    fetchMock.mockResolvedValueOnce(
      mockOffResponse({
        hits: [{ code: '3017620422003', product_name: 'Nutella' }],
        count: 1,
        page: 1,
        page_size: 24,
        page_count: 1,
      }),
    );

    const res = await request(app).get('/api/search').query({ q: 'nutella', locale: 'en' });
    expect(res.status).toBe(200);

    expect(recentSearchMocks.create).not.toHaveBeenCalled();
    expect(recentSearchMocks.findFirst).not.toHaveBeenCalled();
  });

  it('records a successful search that returns zero results', async () => {
    mockLoggedInAs(1);
    fetchMock.mockResolvedValueOnce(mockOffResponse({ hits: [], count: 0, page: 1, page_size: 24, page_count: 0 }));

    const res = await request(app).get('/api/search').query({ q: 'zzzznonexistent', locale: 'en' }).set('Cookie', SESSION_COOKIE);
    expect(res.status).toBe(200);

    expect(recentSearchMocks.create).toHaveBeenCalledWith({ data: { userId: 1, query: 'zzzznonexistent' } });
  });

  it('does not record when the query is missing (400)', async () => {
    mockLoggedInAs(1);
    const res = await request(app).get('/api/search').set('Cookie', SESSION_COOKIE);
    expect(res.status).toBe(400);

    expect(recentSearchMocks.create).not.toHaveBeenCalled();
    expect(recentSearchMocks.findFirst).not.toHaveBeenCalled();
  });

  it('does not record when the upstream service fails (502)', async () => {
    mockLoggedInAs(1);
    fetchMock.mockResolvedValueOnce(mockOffResponse({ detail: 'boom' }, { ok: false, status: 500 }));

    const res = await request(app).get('/api/search').query({ q: 'nutella', locale: 'en' }).set('Cookie', SESSION_COOKIE);
    expect(res.status).toBe(502);

    expect(recentSearchMocks.create).not.toHaveBeenCalled();
    expect(recentSearchMocks.findFirst).not.toHaveBeenCalled();
  });

  it('does not record when the upstream request times out (504)', async () => {
    mockLoggedInAs(1);
    fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'));

    const res = await request(app).get('/api/search').query({ q: 'nutella', locale: 'en' }).set('Cookie', SESSION_COOKIE);
    expect(res.status).toBe(504);

    expect(recentSearchMocks.create).not.toHaveBeenCalled();
    expect(recentSearchMocks.findFirst).not.toHaveBeenCalled();
  });
});
