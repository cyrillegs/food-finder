// GET /api/searches/recent
//
// Returns the currently authenticated user's most recent searches, newest
// first, capped at 10 (see recent-searches.service.ts for the cap and
// dedup reasoning). Requires a logged-in user (requireAuth below) - there's
// no per-visitor anonymous history to return, so apps/web shows a "log in
// to see your search history" message instead of the empty-history state
// when logged out; see RecentSearchesPanel.tsx.
import { Router, type Request, type Response } from 'express';
import { getRecentSearches } from './recent-searches.service';
import { requireAuth } from '../auth/auth.middleware';

export const recentSearchesRouter = Router();

recentSearchesRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  // requireAuth has already 401'd and returned if there's no logged-in
  // user, so req.user is guaranteed to be set by the time this runs.
  const searches = await getRecentSearches(req.user!.id);

  res.json({
    results: searches.map((entry) => ({
      id: entry.id,
      query: entry.query,
      createdAt: entry.createdAt.toISOString(),
    })),
  });
});
