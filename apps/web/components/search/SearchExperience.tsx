'use client';

import { useCallback, useState } from 'react';
import { search, type SearchProduct } from '@/lib/api-client';
import { SearchBox } from './SearchBox';
import { ResultsGrid, type SearchStatus } from './ResultsGrid';

type SearchExperienceProps = {
  locale: string;
};

// Client-side container that owns search state and wires SearchBox to
// ResultsGrid. Kept separate from app/[locale]/page.tsx so the page itself
// can stay a Server Component (setRequestLocale needs that for next-intl's
// static rendering).
export function SearchExperience({ locale }: SearchExperienceProps) {
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [subscriptionActive, setSubscriptionActive] = useState(false);

  const handleSearch = useCallback(
    async (query: string) => {
      setStatus('loading');
      try {
        const response = await search(query, locale);
        setResults(response.results);
        setSubscriptionActive(response.subscriptionActive);
        setStatus('success');
      } catch (err) {
        console.error('Search failed:', err);
        setResults([]);
        setStatus('error');
      }
    },
    [locale],
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
      <ResultsGrid results={results} status={status} locale={locale} subscriptionActive={subscriptionActive} />
    </section>
  );
}
