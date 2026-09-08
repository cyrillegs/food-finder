// GET /health - the endpoint CI's deploy job polls as its post-deploy
// verification. Deliberately queries the database rather than returning a
// static literal (see the comment on the route itself): a schema-changing
// merge that forgot to run its production migration should fail this check,
// not deploy "green" and only surface once a real request 500s.
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from './app';

const queryRawMock = vi.hoisted(() => vi.fn());

vi.mock('./prisma', () => ({
  prisma: { $queryRaw: queryRawMock },
}));

describe('GET /health', () => {
  it('returns 200 when the database is reachable', async () => {
    queryRawMock.mockResolvedValue([{ 1: 1 }]);

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns 503 when the database is unreachable - the exact case this check exists to catch', async () => {
    queryRawMock.mockRejectedValue(new Error('connection refused'));

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
  });
});
