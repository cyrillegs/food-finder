import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { errorHandler } from './errorHandler';
import { searchRouter } from '../modules/search/search.route';
import { subscriptionsRouter } from '../modules/subscriptions/subscriptions.route';
import { webhookRouter } from '../modules/subscriptions/webhook.route';
import { gateSearchNutriments } from '../modules/subscriptions/subscriptions.gate';
import { recentSearchesRouter } from '../modules/recent-searches/recent-searches.route';
import { logRecentSearch } from '../modules/recent-searches/recent-searches.log';
import { authRouter } from '../modules/auth/auth.route';

export function createApp() {
  const app = express();

  // `credentials: true` is required for the browser to actually send/accept
  // the session cookie on cross-origin requests from apps/web (fetch calls
  // there use `credentials: 'include'` - see lib/api-client.ts). Per the
  // CORS spec, `credentials: true` cannot be combined with a wildcard
  // origin - `origin` here was already a specific configured value before
  // auth existed (not '*'), so this only adds the flag, it doesn't need to
  // change how the origin itself is resolved.
  // `||`, not `??`: an env var that is *set but empty* (easy to do in a
  // hosting dashboard) is a misconfiguration, not a deliberate value, and
  // `??` would pass that empty string straight through to the cors
  // middleware - which then stops echoing a specific origin while
  // `credentials: true` is still set, a combination browsers reject
  // outright. Falling back to the local dev origin makes that failure
  // loud and local instead of silent and production-only.
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      credentials: true,
    }),
  );

  // Stripe webhook signature verification needs the raw, unparsed request
  // body. This router is mounted BEFORE the global express.json() below -
  // and applies its own express.raw() scoped to just its one route - so
  // that parser is the only thing that ever touches /api/webhooks/stripe's
  // body. Mounting it after express.json() (or letting it rely on the
  // global parser) would silently break signature verification, since the
  // body would already be consumed/parsed by the time this route saw it.
  app.use('/api/webhooks', webhookRouter);

  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // gateSearchNutriments wraps Search's response so nutriments are stripped
  // unless the demo user's subscription is active - it's Subscriptions
  // module code, applied here rather than inside search.route.ts, so Search
  // stays unaware Subscriptions exists (see subscriptions.gate.ts).
  // logRecentSearch is the same pattern applied by Recent Searches: it wraps
  // the response to log the query as a side effect, without modifying it -
  // see recent-searches.log.ts for why this lives here rather than inside
  // search.route.ts. Order between the two middlewares doesn't matter (each
  // wraps whatever res.json currently is), so they're listed in mount order.
  app.use('/api/auth', authRouter);
  app.use('/api/search', gateSearchNutriments, logRecentSearch, searchRouter);
  app.use('/api/subscriptions', subscriptionsRouter);
  app.use('/api/searches/recent', recentSearchesRouter);

  // Error handler must be registered last so it catches errors from every
  // route/middleware above it.
  app.use(errorHandler);

  return app;
}

export const app = createApp();
