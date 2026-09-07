// GET /api/searches/recent
//
// Returns the demo user's most recent searches, newest first, capped at 10
// (see recent-searches.service.ts for the cap and dedup reasoning). No query
// params - there's exactly one demo user and exactly one thing to ask for.
import { Router, type Request, type Response } from 'express';
import { getRecentSearches } from './recent-searches.service';

export const recentSearchesRouter = Router();

recentSearchesRouter.get('/', async (_req: Request, res: Response) => {
  const searches = await getRecentSearches();

  res.json({
    results: searches.map((entry) => ({
      id: entry.id,
      query: entry.query,
      createdAt: entry.createdAt.toISOString(),
    })),
  });
});
