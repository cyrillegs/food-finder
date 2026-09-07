import { useTranslations } from 'next-intl';
import { ProductCard } from './ProductCard';
import type { SearchProduct } from '@/lib/api-client';

export type SearchStatus = 'idle' | 'loading' | 'error' | 'success';

type ResultsGridProps = {
  results: SearchProduct[];
  status: SearchStatus;
  locale: string;
  subscriptionActive: boolean;
};

export function ResultsGrid({ results, status, locale, subscriptionActive }: ResultsGridProps) {
  const t = useTranslations('search');

  if (status === 'idle') {
    return <p className="text-center text-sm text-muted">{t('promptMessage')}</p>;
  }

  if (status === 'loading') {
    return (
      <p role="status" className="text-center text-sm text-muted">
        {t('loadingLabel')}
      </p>
    );
  }

  if (status === 'error') {
    return (
      <p role="alert" className="text-center text-sm text-red-700">
        {t('errorMessage')}
      </p>
    );
  }

  if (results.length === 0) {
    return <p className="text-center text-sm text-muted">{t('emptyMessage')}</p>;
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-8 gap-y-12">
      {results.map((product) => (
        <ProductCard key={product.code} product={product} locale={locale} subscriptionActive={subscriptionActive} />
      ))}
    </div>
  );
}
