import { useTranslations } from 'next-intl';
import { ProductCard } from './ProductCard';
import type { SearchProduct } from '@/lib/api-client';

export type SearchStatus = 'idle' | 'loading' | 'error' | 'success';

type ResultsGridProps = {
  results: SearchProduct[];
  status: SearchStatus;
  locale: string;
};

export function ResultsGrid({ results, status, locale }: ResultsGridProps) {
  const t = useTranslations('search');

  if (status === 'idle') {
    return <p>{t('promptMessage')}</p>;
  }

  if (status === 'loading') {
    return <p role="status">{t('loadingLabel')}</p>;
  }

  if (status === 'error') {
    return <p role="alert">{t('errorMessage')}</p>;
  }

  if (results.length === 0) {
    return <p>{t('emptyMessage')}</p>;
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: '1rem',
        marginTop: '1.5rem',
      }}
    >
      {results.map((product) => (
        <ProductCard key={product.code} product={product} locale={locale} />
      ))}
    </div>
  );
}
