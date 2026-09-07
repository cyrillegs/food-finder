'use client';

import { useCallback, useEffect, useState } from 'react';
import { deleteRecentSearch, getRecentSearches, search, type RecentSearchEntry, type SearchProduct } from '@/lib/api-client';
import { SearchBox } from './SearchBox';
import { ResultsGrid, type SearchStatus } from './ResultsGrid';
import { RecentSearchesPanel } from '../recent-searches/RecentSearchesPanel';
import { useAuth } from '../auth/AuthProvider';

type SearchExperienceProps = {
  locale: string;
};

// Client-side container that owns search state and wires SearchBox to
// ResultsGrid (and, since Module 5, RecentSearchesPanel). Kept separate from
// app/[locale]/page.tsx so the page itself can stay a Server Component
// (setRequestLocale needs that for next-intl's static rendering).
export function SearchExperience({ locale }: SearchExperienceProps) {
  const { user } = useAuth();
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearchEntry[]>([]);

  // GET /api/searches/recent now requires a logged-in user (401s
  // otherwise) - rather than let every anonymous visitor's page load
  // trigger a call that's guaranteed to fail, this only fetches at all once
  // `user` is known. RecentSearchesPanel gets `isLoggedIn` separately (see
  // below) so it can render its own "log in to see your history" state
  // rather than silently showing an empty list.
  //
  // Recent Searches is a convenience panel, not core search - a failed
  // fetch here shouldn't surface as a page-level error, it just leaves the
  // panel showing whatever it last had (empty on first load).
  const refreshRecentSearches = useCallback(async () => {
    if (!user) {
      setRecentSearches([]);
      return;
    }
    try {
      setRecentSearches(await getRecentSearches());
    } catch (err) {
      console.error('Failed to load recent searches:', err);
    }
  }, [user]);

  // Re-fetched whenever auth state resolves/changes (login, logout) and
  // after every completed search (below) so a just-completed search - or
  // the dedup bump from re-running one already at the top of the list -
  // shows up without a page reload.
  useEffect(() => {
    void refreshRecentSearches();
  }, [refreshRecentSearches]);

  const handleSearch = useCallback(
    async (query: string) => {
      setStatus('loading');
      try {
        const response = await search(query, locale);
        setResults(response.results);
        setSubscriptionActive(response.subscriptionActive);
        setStatus('success');
        void refreshRecentSearches();
      } catch (err) {
        console.error('Search failed:', err);
        setResults([]);
        setStatus('error');
      }
    },
    [locale, refreshRecentSearches],
  );

  // Hero moment before any search has been made (status stays 'idle' until
  // the first submit), collapsing to a compact top bar from the moment a
  // search is in flight onward - see SearchBox's isHero prop.
  // Optimistic-free: waits for the delete to actually succeed server-side
  // before re-fetching, rather than removing the entry from local state
  // immediately - this is a rare, deliberate action (not a hot path like
  // search), so the small round-trip delay isn't worth the risk of the list
  // briefly disagreeing with the server on a failure.
  const handleDelete = useCallback(
    async (id: number) => {
      try {
        await deleteRecentSearch(id);
        void refreshRecentSearches();
      } catch (err) {
        console.error('Failed to delete recent search:', err);
      }
    },
    [refreshRecentSearches],
  );

  const isHero = status === 'idle';

  return (
    <section
      className={
        isHero
          ? 'flex min-h-[60vh] flex-col items-center justify-center gap-8 py-12'
          : 'flex flex-col gap-10 py-8'
      }
    >
      <SearchBox onSearch={handleSearch} isLoading={status === 'loading'} isHero={isHero} />
      <RecentSearchesPanel
        searches={recentSearches}
        onSelect={handleSearch}
        onDelete={handleDelete}
        isLoggedIn={Boolean(user)}
        isHero={isHero}
      />
      <ResultsGrid results={results} status={status} locale={locale} subscriptionActive={subscriptionActive} />
    </section>
  );
}
