import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { errorHandler } from './errorHandler';
import { searchRouter } from '../modules/search/search.route';
import { subscriptionsRouter } from '../modules/subscriptions/subscriptions.route';
import { webhookRouter } from '../modules/subscriptions/webhook.route';
import { gateSearchNutriments } from '../modules/subscriptions/subscriptions.gate';

export function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000' }));

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

  // Module routers mount here (recent-searches - added in a later module).
  // gateSearchNutriments wraps Search's response so nutriments are stripped
  // unless the demo user's subscription is active - it's Subscriptions
  // module code, applied here rather than inside search.route.ts, so Search
  // stays unaware Subscriptions exists (see subscriptions.gate.ts).
  app.use('/api/search', gateSearchNutriments, searchRouter);
  app.use('/api/subscriptions', subscriptionsRouter);

  // Error handler must be registered last so it catches errors from every
  // route/middleware above it.
  app.use(errorHandler);

  return app;
}

export const app = createApp();
