'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

type SearchBoxProps = {
  onSearch: (query: string) => void;
  isLoading?: boolean;
  // The one deliberate layout shift in the redesign: a large, centered
  // "hero" search moment before any search has been made, collapsing into a
  // compact top bar once one has (see SearchExperience, which derives this
  // from search status). A static class-based switch rather than an
  // animated transition, per the design brief's fallback allowance -
  // animating this without risking the existing e2e locators felt like
  // more complexity than the payoff justified.
  isHero?: boolean;
};

export function SearchBox({ onSearch, isLoading = false, isHero = false }: SearchBoxProps) {
  const t = useTranslations('search');
  const [value, setValue] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return;
    }
    onSearch(trimmed);
  }

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      aria-label={t('heading')}
      className={isHero ? 'w-full max-w-2xl' : 'w-full max-w-3xl'}
    >
      <label
        htmlFor="search-box-input"
        className={
          isHero
            ? 'mb-5 block text-center font-display text-3xl font-medium text-ink sm:text-4xl'
            : 'mb-2 block text-sm font-medium text-muted'
        }
      >
        {t('heading')}
      </label>
      <div className={isHero ? 'flex flex-col gap-3 sm:flex-row' : 'flex gap-2'}>
        <input
          id="search-box-input"
          name="q"
          type="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('placeholder')}
          className={
            isHero
              ? 'w-full border-b-2 border-ink bg-transparent px-1 py-3 text-lg text-ink placeholder:text-muted focus:outline-none'
              : 'w-full border-b border-ink/30 bg-transparent px-1 py-2 text-base text-ink placeholder:text-muted focus:border-ink focus:outline-none'
          }
        />
        <button
          type="submit"
          disabled={isLoading}
          className={
            isHero
              ? 'shrink-0 bg-ink px-6 py-3 text-base font-medium text-paper transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-60'
              : 'shrink-0 bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-60'
          }
        >
          {isLoading ? t('loadingLabel') : t('submitLabel')}
        </button>
      </div>
    </form>
  );
}
