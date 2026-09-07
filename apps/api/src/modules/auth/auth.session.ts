// Session cookie configuration shared between the routes that set/clear it
// (auth.route.ts) and the middleware that reads it (auth.middleware.ts).
import type { CookieOptions } from 'express';

export const SESSION_COOKIE_NAME = 'ff_session';

// 7 days: long enough that someone reviewing this project doesn't get
// logged out mid-review, short enough that a stale/forgotten session
// doesn't linger indefinitely. There's no "remember me" checkbox or
// sliding-expiration requirement here, so a single fixed-lifetime session -
// re-issued fresh on the next login - is the simplest thing that works.
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// `secure` is conditional on NODE_ENV rather than always true: local dev
// runs both apps over plain http://localhost (see apps/api/.env.example),
// where a Secure cookie set by the API would never be sent back by the
// browser at all (Secure requires HTTPS, and this stack has none locally).
// Production, deployed behind Dokploy with HTTPS, runs with
// NODE_ENV=production and gets the real Secure flag.
//
// `sameSite: 'lax'` rather than 'strict': in production the web and api
// apps live on sibling subdomains of the same registrable domain
// (food-finder.cdlegaspi.site / food-finder-api.cdlegaspi.site). Browsers
// classify SameSite by registrable domain, not full origin, so these two
// are "same-site" to each other despite being different origins - 'lax'
// already allows the cross-subdomain fetch requests apps/web makes (with
// credentials: 'include') to carry the cookie. 'strict' would only add
// extra restriction on top-level navigations arriving from outside the
// site entirely, which this app has no reason to need.
export function sessionCookieOptions(maxAgeMs: number = SESSION_DURATION_MS): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}
