// POST /api/auth/login
// POST /api/auth/logout
// GET  /api/auth/me
//
// No registration route by design (see the PR description's scope note):
// this project's 5 accounts are pre-seeded (apps/api/prisma/seed.ts), not
// self-service signup.
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { endSession, login } from './auth.service';
import { getCurrentUser, getSessionToken } from './auth.middleware';
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS, sessionCookieOptions } from './auth.session';

export const authRouter = Router();

const GENERIC_LOGIN_ERROR = 'Invalid email or password.';

// Every attempt - successful or not, even for an unknown email - runs a
// full argon2id verification (login() always does, to stay
// timing-attack-resistant against user enumeration). Unthrottled, that
// makes /login both an unbounded credential-guessing oracle and a cheap
// way to force the process into repeated, deliberately memory-heavy
// hashing work. Not skipSuccessfulRequests: the memory-exhaustion angle
// applies to every attempt regardless of outcome, so a run of correct
// logins from one IP is throttled the same as a run of guesses.
//
// Keyed by IP (the default), which is why shared/app.ts sets `trust
// proxy` to exactly 1 - without that, every request behind Traefik would
// appear to come from the same address and this would rate-limit the
// whole site's logins together instead of per visitor.
//
// Limit is generous enough for a reviewer manually testing all 5 seeded
// accounts plus a couple of deliberate wrong-password checks from one
// browser, while still bounding how many guesses an attacker gets.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Too many login attempts. Please try again later.' } },
});

authRouter.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const body = req.body as { email?: unknown; password?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    // Same generic message as a wrong credential, not a distinct "missing
    // field" error - no reason to give an attacker a different signal for
    // a blank field vs. an actually-wrong one.
    res.status(400).json({ error: { message: GENERIC_LOGIN_ERROR } });
    return;
  }

  const result = await login(email, password, SESSION_DURATION_MS);
  if (!result) {
    res.status(401).json({ error: { message: GENERIC_LOGIN_ERROR } });
    return;
  }

  res.cookie(SESSION_COOKIE_NAME, result.token, sessionCookieOptions());
  res.json({ user: result.user });
});

authRouter.post('/logout', async (req: Request, res: Response) => {
  const token = getSessionToken(req);
  if (token) {
    await endSession(token);
  }
  // clearCookie must be called with matching attributes (path/sameSite/
  // secure) to actually clear the cookie the browser has - maxAge is
  // irrelevant for clearing so it's omitted, everything else must match
  // what login() set.
  res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
  res.json({ success: true });
});

authRouter.get('/me', async (req: Request, res: Response) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: { message: 'Not logged in.' } });
    return;
  }
  res.json({ user });
});
