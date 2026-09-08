// Recent Searches, now scoped per authenticated User instead of the one
// hardcoded DemoUser row. Every function here takes the acting user's id
// explicitly - callers (recent-searches.route.ts, recent-searches.log.ts)
// resolve that id via the auth middleware/session before calling in.
//
// RecentSearch has no relation back to User in the schema (see
// prisma/schema.prisma - just a plain `userId Int` column with an index, no
// @relation), matching how it never had one back to DemoUser either.
import { prisma } from '../../shared/prisma';
import type { RecentSearch } from '@prisma/client';

// The panel only ever shows the 10 most recent - the underlying table is
// left to grow unbounded (RecentSearch rows are cheap, and there's no
// user-facing reason to ever delete history), but every read caps at this
// number so the response payload and the list UI never grow past it.
const MAX_RECENT_SEARCHES = 10;

// Records a search for the given user.
//
// Dedup decision (revised): collapses against ANY existing row for this
// user with the same query text, not just the single most-recently-logged
// one - if a match exists anywhere in their history, this bumps its
// createdAt to now (moving it to the top) instead of inserting a new row.
// An earlier version of this only checked the most-recent row, on the
// reasoning that a query resurfacing after other searches happened in
// between reflects "the user came back to this" rather than "the user is
// re-submitting the same request." In practice that produced a visibly
// confusing panel: alternating between two queries (search A, then B, then
// A again, then B again) filled the top of the list with duplicate entries
// of both - "recent searches" showing the same two queries twice each reads
// as broken regardless of the reasoning behind it. Full dedup means a query
// can only ever occupy one slot in the panel, which is what "recent
// searches" implies to a user in the first place.
export async function recordSearch(userId: number, query: string): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) {
    return;
  }

  const existing = await prisma.recentSearch.findFirst({
    where: { userId, query: trimmed },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    await prisma.recentSearch.update({
      where: { id: existing.id },
      data: { createdAt: new Date() },
    });
    return;
  }

  await prisma.recentSearch.create({
    data: { userId, query: trimmed },
  });
}

// The given user's most recent searches, newest first, capped at
// MAX_RECENT_SEARCHES - see the constant above for why the cap exists.
export async function getRecentSearches(userId: number): Promise<RecentSearch[]> {
  return prisma.recentSearch.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: MAX_RECENT_SEARCHES,
  });
}

// Deletes one recent-search entry, scoped to the given user - the `userId`
// is part of the WHERE clause itself (not checked separately after an
// unscoped lookup), so this can never delete a row belonging to a different
// user no matter what id is passed in. `deleteMany` rather than `delete`
// specifically because `delete` requires its `where` to be a unique
// identifier on its own (just `id`) - a compound id+userId condition needs
// the `deleteMany` shape instead. Returns whether a row actually matched,
// so the route can tell "deleted" apart from "no such entry for this user"
// (which covers both a genuinely unknown id and someone else's id) without
// leaking which case it was - both look identical to the caller, which is
// the correct behavior for someone probing ids that aren't theirs.
export async function deleteRecentSearch(userId: number, searchId: number): Promise<boolean> {
  const result = await prisma.recentSearch.deleteMany({
    where: { id: searchId, userId },
  });
  return result.count > 0;
}
