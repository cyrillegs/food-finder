import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { errorHandler } from './errorHandler';

export function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000' }));
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Module routers mount here (search, subscriptions, recent-searches - added
  // in later modules), e.g.:
  //   app.use('/api/search', searchRouter);
  //   app.use('/api/subscriptions', subscriptionsRouter);
  //   app.use('/api/recent-searches', recentSearchesRouter);

  // Error handler must be registered last so it catches errors from every
  // route/middleware above it.
  app.use(errorHandler);

  return app;
}

export const app = createApp();
