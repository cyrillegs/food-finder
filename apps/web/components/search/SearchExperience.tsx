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

  const handleSearch = useCallback(
    async (query: string) => {
      setStatus('loading');
      try {
        const response = await search(query, locale);
        setResults(response.results);
        setStatus('success');
      } catch (err) {
        console.error('Search failed:', err);
        setResults([]);
        setStatus('error');
      }
    },
    [locale],
  );

  return (
    <section>
      <SearchBox onSearch={handleSearch} isLoading={status === 'loading'} />
      <ResultsGrid results={results} status={status} locale={locale} />
    </section>
  );
}
