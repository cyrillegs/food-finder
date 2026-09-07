import { useTranslations } from 'next-intl';
import type { SearchProduct } from '@/lib/api-client';
import { SubscribeButton } from './SubscribeButton';

type NutrimentsPanelProps = {
  product: SearchProduct;
  locale: string;
};

// Open Food Facts' nutriments object has dozens of possible keys - this only
// surfaces the handful a shopper actually scans for on a product, rather
// than dumping the raw object onto the card.
const DISPLAYED_NUTRIMENTS: Array<{ key: string; labelKey: string }> = [
  { key: 'energy-kcal_100g', labelKey: 'energyKcal' },
  { key: 'fat_100g', labelKey: 'fat' },
  { key: 'saturated-fat_100g', labelKey: 'saturatedFat' },
  { key: 'carbohydrates_100g', labelKey: 'carbohydrates' },
  { key: 'sugars_100g', labelKey: 'sugars' },
  { key: 'fiber_100g', labelKey: 'fiber' },
  { key: 'proteins_100g', labelKey: 'proteins' },
  { key: 'salt_100g', labelKey: 'salt' },
];

// Shown on every ProductCard. When `product.nutriments` is present (demo
// user is subscribed - see apps/api's subscriptions.gate.ts, which is what
// actually enforces this server-side) it renders the values; otherwise it
// shows a locked message plus a way to subscribe, rather than hiding the
// section entirely, so the value of subscribing is visible right where it
// matters.
export function NutrimentsPanel({ product, locale }: NutrimentsPanelProps) {
  const t = useTranslations('subscriptions');

  if (!product.nutriments) {
    return (
      <div style={{ borderTop: '1px solid #eee', marginTop: '0.5rem', paddingTop: '0.5rem' }}>
        <p style={{ fontSize: '0.85rem', color: '#777', margin: '0 0 0.5rem' }}>{t('nutrimentsLockedMessage')}</p>
        <SubscribeButton locale={locale} />
      </div>
    );
  }

  const entries = DISPLAYED_NUTRIMENTS.map(({ key, labelKey }) => {
    const value = product.nutriments?.[key];
    return typeof value === 'number' ? { labelKey, value } : null;
  }).filter((entry): entry is { labelKey: string; value: number } => entry !== null);

  if (entries.length === 0) {
    return null;
  }

  return (
    <dl
      style={{
        borderTop: '1px solid #eee',
        marginTop: '0.5rem',
        paddingTop: '0.5rem',
        fontSize: '0.85rem',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: '0.15rem 0.5rem',
      }}
    >
      {entries.map(({ labelKey, value }) => (
        <div key={labelKey} style={{ display: 'contents' }}>
          <dt style={{ color: '#555' }}>{t(`nutrimentLabels.${labelKey}`)}</dt>
          <dd style={{ margin: 0, textAlign: 'right' }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
