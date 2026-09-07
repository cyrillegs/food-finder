// GET /api/searches/recent
//
// Returns the currently authenticated user's most recent searches, newest
// first, capped at 10 (see recent-searches.service.ts for the cap and
// dedup reasoning). Requires a logged-in user (requireAuth below) - there's
// no per-visitor anonymous history to return, so apps/web shows a "log in
// to see your search history" message instead of the empty-history state
// when logged out; see RecentSearchesPanel.tsx.
import { Router, type Request, type Response } from 'express';
import { deleteRecentSearch, getRecentSearches } from './recent-searches.service';
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

// DELETE /api/searches/recent/:id - removes one entry from the logged-in
// user's own history. 404 covers both "no entry with this id at all" and
// "this id belongs to someone else" identically (see
// recent-searches.service.ts's deleteRecentSearch) - a caller probing ids
// that aren't theirs learns nothing from the response that distinguishes
// the two cases.
recentSearchesRouter.delete('/:id', requireAuth, async (req: Request<{ id: string }>, res: Response) => {
  const searchId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(searchId)) {
    res.status(400).json({ error: { message: 'Invalid search id.' } });
    return;
  }

  const deleted = await deleteRecentSearch(req.user!.id, searchId);
  if (!deleted) {
    res.status(404).json({ error: { message: 'Recent search not found.' } });
    return;
  }

  res.status(204).end();
});
