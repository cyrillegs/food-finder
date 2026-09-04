import { useTranslations } from 'next-intl';
import type { SearchProduct } from '@/lib/api-client';

type ProductCardProps = {
  product: SearchProduct;
};

// Name/brand/image only - no nutrition data. Nutriments are gated behind
// Stripe starting in Module 2 and aren't wired through to the frontend yet.
export function ProductCard({ product }: ProductCardProps) {
  const t = useTranslations('search');
  const name = product.name ?? t('unnamedProduct');
  const brand = product.brand ?? t('unknownBrand');

  return (
    <article
      style={{
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <div
        style={{
          aspectRatio: '1 / 1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f5f5f5',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote OFF
          // images aren't configured in next.config.ts; a plain <img> avoids
          // needing to touch Module 0's build config for this module.
          <img
            src={product.imageUrl}
            alt={name}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        ) : (
          <span aria-hidden="true" style={{ color: '#999', fontSize: '0.85rem' }}>
            {t('noImageLabel')}
          </span>
        )}
      </div>
      <strong>{name}</strong>
      <span style={{ color: '#555', fontSize: '0.9rem' }}>{brand}</span>
    </article>
  );
}
