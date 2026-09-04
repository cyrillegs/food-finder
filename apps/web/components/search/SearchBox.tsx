'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

type SearchBoxProps = {
  onSearch: (query: string) => void;
  isLoading?: boolean;
};

export function SearchBox({ onSearch, isLoading = false }: SearchBoxProps) {
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
    <form onSubmit={handleSubmit} role="search" aria-label={t('heading')}>
      <label htmlFor="search-box-input" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
        {t('heading')}
      </label>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          id="search-box-input"
          name="q"
          type="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('placeholder')}
          style={{ flex: 1, padding: '0.5rem', fontSize: '1rem' }}
        />
        <button type="submit" disabled={isLoading} style={{ padding: '0.5rem 1rem' }}>
          {isLoading ? t('loadingLabel') : t('submitLabel')}
        </button>
      </div>
    </form>
  );
}
