// Mocks Prisma directly (`prisma.recentSearch.*`) for the service-level
// tests below - same convention as search.test.ts/subscriptions.test.ts:
// never touch a real database in this suite. `prisma.demoUser.findUnique` is
// also mocked because every /api/search request passes through the
// Subscriptions module's gating middleware first (see search.test.ts's own
// comment on this), which this file's route-level tests exercise too.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../shared/app';
import { recordSearch, getRecentSearches } from './recent-searches.service';

// vi.mock calls are hoisted above the imports above by Vitest, so
// shared/app.ts (and, transitively, shared/prisma.ts) never sees the real
// Prisma client in this file. The inner arrow functions close over these
// vi.fn()s by reference rather than reading them at factory-definition
// time, so the const declarations below are safe to keep simple (same
// pattern as search.test.ts).
const demoUserFindUniqueMock = vi.fn();
const recentSearchMocks = {
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};

vi.mock('../../shared/prisma', () => ({
  prisma: {
    demoUser: { findUnique: (...args: unknown[]) => demoUserFindUniqueMock(...args) },
    recentSearch: {
      findFirst: (...args: unknown[]) => recentSearchMocks.findFirst(...args),
      findMany: (...args: unknown[]) => recentSearchMocks.findMany(...args),
      create: (...args: unknown[]) => recentSearchMocks.create(...args),
      update: (...args: unknown[]) => recentSearchMocks.update(...args),
    },
  },
}));

function row(id: number, query: string, createdAt: Date) {
  return { id, demoUserId: 1, query, createdAt };
}

describe('recent-searches.service', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('recordSearch', () => {
    it('creates a new row when there is no existing history', async () => {
      recentSearchMocks.findFirst.mockResolvedValue(null);

      await recordSearch('nutella');

      expect(recentSearchMocks.create).toHaveBeenCalledWith({
        data: { demoUserId: 1, query: 'nutella' },
      });
      expect(recentSearchMocks.update).not.toHaveBeenCalled();
    });

    it('creates a new row when the most recent query differs', async () => {
      recentSearchMocks.findFirst.mockResolvedValue(row(1, 'chocolate', new Date('2026-01-01T00:00:00Z')));

      await recordSearch('nutella');

      expect(recentSearchMocks.create).toHaveBeenCalledWith({
        data: { demoUserId: 1, query: 'nutella' },
      });
      expect(recentSearchMocks.update).not.toHaveBeenCalled();
    });

    // The core dedup decision: an immediate repeat of the most-recently-
    // logged query (searching "nutella" twice in a row, or clicking a recent
    // entry that's already the top one) bumps that row's timestamp instead
    // of inserting a duplicate - so the panel never fills up with copies of
    // the same query back-to-back.
    it('bumps the existing row instead of creating a duplicate when the query repeats immediately', async () => {
      recentSearchMocks.findFirst.mockResolvedValue(row(7, 'nutella', new Date('2026-01-01T00:00:00Z')));

      await recordSearch('nutella');

      expect(recentSearchMocks.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { createdAt: expect.any(Date) },
      });
      expect(recentSearchMocks.create).not.toHaveBeenCalled();
    });

    it('trims incoming whitespace before comparing/storing', async () => {
      recentSearchMocks.findFirst.mockResolvedValue(row(7, 'nutella', new Date('2026-01-01T00:00:00Z')));

      await recordSearch('  nutella  ');

      expect(recentSearchMocks.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { createdAt: expect.any(Date) },
      });
      expect(recentSearchMocks.create).not.toHaveBeenCalled();
    });

    it('does nothing for a blank query', async () => {
      await recordSearch('   ');

      expect(recentSearchMocks.findFirst).not.toHaveBeenCalled();
      expect(recentSearchMocks.create).not.toHaveBeenCalled();
      expect(recentSearchMocks.update).not.toHaveBeenCalled();
    });
  });

  describe('getRecentSearches', () => {
    it('queries newest-first, capped at 10, scoped to the demo user', async () => {
      recentSearchMocks.findMany.mockResolvedValue([]);

      await getRecentSearches();

      expect(recentSearchMocks.findMany).toHaveBeenCalledWith({
        where: { demoUserId: 1 },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });

    it('returns whatever Prisma hands back, newest first', async () => {
      const rows = [row(3, 'chocolate', new Date('2026-01-03T00:00:00Z')), row(2, 'nutella', new Date('2026-01-02T00:00:00Z'))];
      recentSearchMocks.findMany.mockResolvedValue(rows);

      const result = await getRecentSearches();

      expect(result).toBe(rows);
    });
  });
});

describe('GET /api/searches/recent', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the capped, newest-first list as ISO timestamps', async () => {
    recentSearchMocks.findMany.mockResolvedValue([
      row(2, 'nutella', new Date('2026-01-02T00:00:00.000Z')),
      row(1, 'chocolate', new Date('2026-01-01T00:00:00.000Z')),
    ]);

    const res = await request(app).get('/api/searches/recent');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      results: [
        { id: 2, query: 'nutella', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 1, query: 'chocolate', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
  });

  it('returns an empty list when the demo user has no history', async () => {
    recentSearchMocks.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/searches/recent');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [] });
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
    demoUserFindUniqueMock.mockResolvedValue({ id: 1, subscriptionStatus: 'inactive' });
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

  it('records a successful search with results', async () => {
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

    // The middleware awaits the record write before the response is
    // actually sent (see recent-searches.log.ts), so by the time supertest
    // resolves above, this has already happened - no extra tick needed.
    expect(recentSearchMocks.create).toHaveBeenCalledWith({ data: { demoUserId: 1, query: 'nutella' } });
  });

  it('records a successful search that returns zero results', async () => {
    fetchMock.mockResolvedValueOnce(mockOffResponse({ hits: [], count: 0, page: 1, page_size: 24, page_count: 0 }));

    const res = await request(app).get('/api/search').query({ q: 'zzzznonexistent', locale: 'en' });
    expect(res.status).toBe(200);

    expect(recentSearchMocks.create).toHaveBeenCalledWith({ data: { demoUserId: 1, query: 'zzzznonexistent' } });
  });

  it('does not record when the query is missing (400)', async () => {
    const res = await request(app).get('/api/search');
    expect(res.status).toBe(400);

    expect(recentSearchMocks.create).not.toHaveBeenCalled();
    expect(recentSearchMocks.findFirst).not.toHaveBeenCalled();
  });

  it('does not record when the upstream service fails (502)', async () => {
    fetchMock.mockResolvedValueOnce(mockOffResponse({ detail: 'boom' }, { ok: false, status: 500 }));

    const res = await request(app).get('/api/search').query({ q: 'nutella', locale: 'en' });
    expect(res.status).toBe(502);

    expect(recentSearchMocks.create).not.toHaveBeenCalled();
    expect(recentSearchMocks.findFirst).not.toHaveBeenCalled();
  });

  it('does not record when the upstream request times out (504)', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'));

    const res = await request(app).get('/api/search').query({ q: 'nutella', locale: 'en' });
    expect(res.status).toBe(504);

    expect(recentSearchMocks.create).not.toHaveBeenCalled();
    expect(recentSearchMocks.findFirst).not.toHaveBeenCalled();
  });
});
