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
      <div className="mt-3 border-t-4 border-ink pt-3">
        {/* Decorative: a visual suggestion of redacted nutrient rows, not a
            replacement for the accessible message below - screen readers
            skip this and get the real text via the <p> underneath it. */}
        <div aria-hidden="true" className="mb-3 flex flex-col gap-1.5">
          <span className="block h-3 w-4/5 bg-redacted" />
          <span className="block h-3 w-1/2 bg-redacted" />
          <span className="block h-3 w-5/6 bg-redacted" />
          <span className="block h-3 w-2/3 bg-redacted" />
        </div>
        <p className="mb-3 text-sm text-muted">{t('nutrimentsLockedMessage')}</p>
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
    // The one deliberately "loud" motif in the redesign, borrowed from real
    // FDA/EU nutrition-facts panels: a bold rule directly above the data,
    // tight per-row rules, and right-aligned tabular numerals in the mono
    // face - used only here, not smeared across the app's calmer chrome.
    <dl className="mt-3 divide-y divide-ink/15 border-t-4 border-ink pt-1 text-sm">
      {entries.map(({ labelKey, value }) => (
        <div key={labelKey} className="flex items-baseline justify-between py-1">
          <dt className="text-muted">{t(`nutrimentLabels.${labelKey}`)}</dt>
          <dd className="m-0 font-mono text-ink tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
