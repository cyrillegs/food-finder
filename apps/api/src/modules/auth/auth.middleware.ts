// Reads the session cookie off an incoming request and resolves it to a
// user. Two ways other modules consume this:
//   - requireAuth: an Express middleware for routes that must be logged in
//     (checkout-session, GET /api/searches/recent) - 401s with a generic
//     message otherwise and attaches req.user for the route to use.
//   - getCurrentUser: a plain async function for code that wants "who's
//     asking, if anyone" without hard-requiring a session - the
//     Subscriptions gate (anonymous = locked, same as before) and Recent
//     Searches logging (anonymous = don't log, nothing to attach it to).
import { parse as parseCookie } from 'cookie';
import type { NextFunction, Request, Response } from 'express';
import { getUserByToken, type PublicUser } from './auth.service';
import { SESSION_COOKIE_NAME } from './auth.session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

export function getSessionToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }
  return parseCookie(header)[SESSION_COOKIE_NAME];
}

export async function getCurrentUser(req: Request): Promise<PublicUser | null> {
  return getUserByToken(getSessionToken(req));
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: { message: 'Login required.' } });
    return;
  }
  req.user = user;
  next();
}
