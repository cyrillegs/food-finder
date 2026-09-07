// Recent Searches - "one demo user" history, the same shared-state model as
// Subscriptions (see subscriptions.service.ts's DEMO_USER_ID constant and
// comment). No auth, no multi-tenancy: every function here reads/writes
// against that single demoUserId.
//
// Unlike Subscriptions, RecentSearch has no relation back to DemoUser in the
// schema (see prisma/schema.prisma - just a plain `demoUserId Int` column
// with an index, no `@relation`), so there's no DemoUser row to look up here
// the way createCheckoutSession looks one up for its stripeCustomerId - the
// id is just a constant scoping every query, mirroring how
// subscriptions.gate.ts's isNutrimentsUnlocked queries DemoUser directly by
// id rather than via a relation.
import { prisma } from '../../shared/prisma';
import type { RecentSearch } from '@prisma/client';

// Matches the single seeded row from apps/api/prisma/seed.ts.
const DEMO_USER_ID = 1;

// The panel only ever shows the 10 most recent - the underlying table is
// left to grow unbounded (RecentSearch rows are cheap, and there's no
// user-facing reason to ever delete history), but every read caps at this
// number so the response payload and the list UI never grow past it.
const MAX_RECENT_SEARCHES = 10;

// Records a search for the demo user.
//
// Dedup decision: this only collapses against the single most-recently-
// logged row for the demo user, not "does this query appear anywhere in
// history". If that row's query text matches exactly, this bumps its
// createdAt to now instead of inserting a new row - which covers the two
// cases the plan calls out explicitly (searching the same thing twice in a
// row, and clicking a recent-searches entry that happens to already be the
// top entry) without a duplicate ever piling up back-to-back. A query that
// repeats later, after other searches happened in between, is treated as a
// genuinely new event and gets its own new row/timestamp - it reflects "the
// user came back to this" rather than "the user is re-submitting the same
// request", and a full history-wide dedup would mean silently deleting or
// reordering an older row out from under a query, which is more surprising
// than useful for a plain chronological history list. This is the simplest
// rule that prevents the "the panel fills up with 10 copies of the same
// query" failure mode without adding history-wide bookkeeping.
export async function recordSearch(query: string): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) {
    return;
  }

  const mostRecent = await prisma.recentSearch.findFirst({
    where: { demoUserId: DEMO_USER_ID },
    orderBy: { createdAt: 'desc' },
  });

  if (mostRecent && mostRecent.query === trimmed) {
    await prisma.recentSearch.update({
      where: { id: mostRecent.id },
      data: { createdAt: new Date() },
    });
    return;
  }

  await prisma.recentSearch.create({
    data: { demoUserId: DEMO_USER_ID, query: trimmed },
  });
}

// The demo user's most recent searches, newest first, capped at
// MAX_RECENT_SEARCHES - see the constant above for why the cap exists.
export async function getRecentSearches(): Promise<RecentSearch[]> {
  return prisma.recentSearch.findMany({
    where: { demoUserId: DEMO_USER_ID },
    orderBy: { createdAt: 'desc' },
    take: MAX_RECENT_SEARCHES,
  });
}
