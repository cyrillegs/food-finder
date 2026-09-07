import { useTranslations } from 'next-intl';
import type { SearchProduct } from '@/lib/api-client';
import { NutrimentsPanel } from '../subscriptions/NutrimentsPanel';

type ProductCardProps = {
  product: SearchProduct;
  locale: string;
};

// Name/brand/image, plus a nutrition section: NutrimentsPanel renders the
// values when the API included them (subscribed demo user) or a
// subscribe-to-unlock affordance when it didn't - see
// components/subscriptions/NutrimentsPanel.tsx. Gating itself is enforced
// server-side (apps/api's subscriptions.gate.ts strips the field entirely),
// this component just renders whatever it's given.
export function ProductCard({ product, locale }: ProductCardProps) {
  const t = useTranslations('search');
  const name = product.name ?? t('unnamedProduct');
  const brand = product.brand ?? t('unknownBrand');

  return (
    <article className="flex flex-col gap-3">
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-ink/4">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote OFF
          // images aren't configured in next.config.ts; a plain <img> avoids
          // needing to touch Module 0's build config for this module.
          <img src={product.imageUrl} alt={name} className="max-h-full max-w-full object-contain" />
        ) : (
          <span aria-hidden="true" className="text-sm text-muted">
            {t('noImageLabel')}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <strong className="font-sans text-lg font-medium text-ink">{name}</strong>
        <span className="text-sm text-muted">{brand}</span>
      </div>
      <NutrimentsPanel product={product} locale={locale} />
    </article>
  );
}
