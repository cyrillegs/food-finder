'use client';

import { useCallback, useEffect, useState } from 'react';
import { getRecentSearches, search, type RecentSearchEntry, type SearchProduct } from '@/lib/api-client';
import { SearchBox } from './SearchBox';
import { ResultsGrid, type SearchStatus } from './ResultsGrid';
import { RecentSearchesPanel } from '../recent-searches/RecentSearchesPanel';

type SearchExperienceProps = {
  locale: string;
};

// Client-side container that owns search state and wires SearchBox to
// ResultsGrid (and, since Module 5, RecentSearchesPanel). Kept separate from
// app/[locale]/page.tsx so the page itself can stay a Server Component
// (setRequestLocale needs that for next-intl's static rendering).
export function SearchExperience({ locale }: SearchExperienceProps) {
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearchEntry[]>([]);

  // Recent Searches is a convenience panel, not core search - a failed fetch
  // here shouldn't surface as a page-level error, it just leaves the panel
  // showing whatever it last had (empty on first load).
  const refreshRecentSearches = useCallback(async () => {
    try {
      setRecentSearches(await getRecentSearches());
    } catch (err) {
      console.error('Failed to load recent searches:', err);
    }
  }, []);

  // Fetched once on mount, then re-fetched after every completed search
  // (below) so a just-completed search - or the dedup bump from re-running
  // one already at the top of the list - shows up without a page reload.
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
      <RecentSearchesPanel searches={recentSearches} onSelect={handleSearch} isHero={isHero} />
      <ResultsGrid results={results} status={status} locale={locale} subscriptionActive={subscriptionActive} />
    </section>
  );
}
