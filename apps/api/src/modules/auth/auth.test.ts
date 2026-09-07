// Mocks Prisma (`prisma.user`, `prisma.session`) - same convention as every
// other module's test suite: never touch a real database here.
//
// Password hashing itself is NOT mocked - hashPassword/verifyPassword call
// the real `argon2` package, deliberately, so this suite proves hashing
// actually happens (a stored hash is not the plaintext password, and a
// correct password verifies against it) rather than just asserting a mock
// was called. This mirrors subscriptions.test.ts's own choice to exercise
// Stripe's real (network-free) webhook signature verification instead of
// mocking it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../shared/app';
import { hashPassword } from './auth.service';

const { userMock, sessionMock } = vi.hoisted(() => ({
  userMock: {
    findUnique: vi.fn(),
  },
  sessionMock: {
    create: vi.fn(),
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock('../../shared/prisma', () => ({
  prisma: { user: userMock, session: sessionMock },
}));

const TEST_EMAIL = 'demo1@food-finder.local';
const TEST_PASSWORD = 'correct horse battery staple';
const SESSION_COOKIE = 'ff_session=test-session-token';

let realPasswordHash: string;

describe('Auth module', () => {
  // Computed fresh before every test (argon2 salts each hash independently,
  // so this is never the same string twice) rather than once via beforeAll,
  // keeping every test self-contained.
  beforeEach(async () => {
    realPasswordHash = await hashPassword(TEST_PASSWORD);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('password hashing', () => {
    it('never stores the plaintext password', async () => {
      expect(realPasswordHash).not.toBe(TEST_PASSWORD);
      expect(realPasswordHash).not.toContain(TEST_PASSWORD);
    });

    it('produces a real argon2id hash, not a placeholder', async () => {
      expect(realPasswordHash.startsWith('$argon2id$')).toBe(true);
    });

    it('hashes the same password differently each time (unique salt per hash)', async () => {
      const anotherHash = await hashPassword(TEST_PASSWORD);
      expect(anotherHash).not.toBe(realPasswordHash);
    });
  });

  describe('POST /api/auth/login', () => {
    it('logs in with correct credentials, sets an httpOnly session cookie, and never echoes the password hash', async () => {
      userMock.findUnique.mockResolvedValue({
        id: 1,
        email: TEST_EMAIL,
        passwordHash: realPasswordHash,
        subscriptionStatus: 'inactive',
      });
      sessionMock.create.mockResolvedValue({});

      const res = await request(app).post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ user: { id: 1, email: TEST_EMAIL, subscriptionStatus: 'inactive' } });
      expect(JSON.stringify(res.body)).not.toContain(realPasswordHash);

      const setCookie = res.headers['set-cookie'] as unknown as string[];
      expect(setCookie).toBeDefined();
      const sessionCookie = setCookie.find((c) => c.startsWith('ff_session='));
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toMatch(/HttpOnly/i);
      expect(sessionCookie).toMatch(/SameSite=Lax/i);

      expect(sessionMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 1 }) }),
      );
    });

    it('rejects a wrong password with a generic error - indistinguishable from an unknown email', async () => {
      userMock.findUnique.mockResolvedValue({
        id: 1,
        email: TEST_EMAIL,
        passwordHash: realPasswordHash,
        subscriptionStatus: 'inactive',
      });
      const wrongPasswordRes = await request(app)
        .post('/api/auth/login')
        .send({ email: TEST_EMAIL, password: 'definitely-not-the-password' });

      userMock.findUnique.mockResolvedValue(null);
      const unknownEmailRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@food-finder.local', password: TEST_PASSWORD });

      expect(wrongPasswordRes.status).toBe(401);
      expect(unknownEmailRes.status).toBe(401);
      // Same status AND same body for both failure modes - a caller cannot
      // tell "wrong password for a real account" apart from "no such
      // account" from the response alone, which is the actual requirement
      // (standard no-enumeration practice), not just "both are 401s".
      expect(wrongPasswordRes.body).toEqual(unknownEmailRes.body);
      expect(sessionMock.create).not.toHaveBeenCalled();
    });

    it('rejects a missing email or password with the same generic error, not a distinct validation message', async () => {
      const res = await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Invalid email or password.');
    });

    it('does not set a session cookie on failed login', async () => {
      userMock.findUnique.mockResolvedValue(null);

      const res = await request(app).post('/api/auth/login').send({ email: TEST_EMAIL, password: 'wrong' });

      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('deletes the session row and clears the cookie', async () => {
      sessionMock.deleteMany.mockResolvedValue({ count: 1 });

      const res = await request(app).post('/api/auth/logout').set('Cookie', SESSION_COOKIE);

      expect(res.status).toBe(200);
      expect(sessionMock.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.any(Object) }));

      const setCookie = res.headers['set-cookie'] as unknown as string[];
      const sessionCookie = setCookie.find((c) => c.startsWith('ff_session='));
      // Express's clearCookie sets an already-expired cookie with an empty
      // value - confirming the value is cleared is the actual proof the
      // browser will drop it, not just that *a* Set-Cookie header exists.
      expect(sessionCookie).toMatch(/ff_session=;/);
    });

    it('succeeds even with no session cookie present (nothing to clear, not an error)', async () => {
      const res = await request(app).post('/api/auth/logout');

      expect(res.status).toBe(200);
      expect(sessionMock.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns the current user for a valid session cookie', async () => {
      sessionMock.findUnique.mockResolvedValue({
        id: 1,
        tokenHash: 'irrelevant-in-tests',
        userId: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
      userMock.findUnique.mockResolvedValue({ id: 1, email: TEST_EMAIL, subscriptionStatus: 'active' });

      const res = await request(app).get('/api/auth/me').set('Cookie', SESSION_COOKIE);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ user: { id: 1, email: TEST_EMAIL, subscriptionStatus: 'active' } });
    });

    it('returns 401 with no session cookie at all', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(sessionMock.findUnique).not.toHaveBeenCalled();
    });

    it('returns 401 for a session cookie that matches no session row', async () => {
      sessionMock.findUnique.mockResolvedValue(null);

      const res = await request(app).get('/api/auth/me').set('Cookie', SESSION_COOKIE);

      expect(res.status).toBe(401);
    });

    it('returns 401 for an expired session', async () => {
      sessionMock.findUnique.mockResolvedValue({
        id: 1,
        tokenHash: 'irrelevant-in-tests',
        userId: 1,
        expiresAt: new Date(Date.now() - 1000),
      });

      const res = await request(app).get('/api/auth/me').set('Cookie', SESSION_COOKIE);

      expect(res.status).toBe(401);
      expect(userMock.findUnique).not.toHaveBeenCalled();
    });
  });
});
