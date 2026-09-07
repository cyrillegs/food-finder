import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SearchProduct } from '@/lib/api-client';
import { NutrimentsPanel } from '../subscriptions/NutrimentsPanel';

type ProductCardProps = {
  product: SearchProduct;
  locale: string;
  subscriptionActive: boolean;
};

// How long to wait for an image before giving up and showing the "no
// image" placeholder instead. Deliberately much shorter than a browser's
// own connection timeout: confirmed live that a genuinely unreachable OFF
// image host (a real, observed outage - see subscriptions.gate.ts's
// sibling comment history) takes 15-30s for the browser to give up and
// fire onError on its own, which is a bad wait for something that already
// has a graceful fallback. This forces that fallback quickly instead.
const IMAGE_LOAD_TIMEOUT_MS = 6000;

// Name/brand/image, plus a nutrition section: NutrimentsPanel renders the
// values when the API included them (subscribed demo user) or a
// subscribe-to-unlock affordance when it didn't - see
// components/subscriptions/NutrimentsPanel.tsx. Gating itself is enforced
// server-side (apps/api's subscriptions.gate.ts strips the field entirely),
// this component just renders whatever it's given.
export function ProductCard({ product, locale, subscriptionActive }: ProductCardProps) {
  const t = useTranslations('search');
  const name = product.name ?? t('unnamedProduct');
  const brand = product.brand ?? t('unknownBrand');
  // OFF returning a URL doesn't guarantee the image is actually fetchable -
  // their image CDN has real, observed outages independent of the search
  // API itself, which still returns the URL fine. Without this, a failed
  // fetch renders the browser's broken-image icon instead of falling back
  // to the same "no image" treatment used when OFF has no image at all.
  const [imageFailed, setImageFailed] = useState(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!product.imageUrl) {
      return;
    }
    loadTimeoutRef.current = setTimeout(() => setImageFailed(true), IMAGE_LOAD_TIMEOUT_MS);
    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }
    };
  }, [product.imageUrl]);

  function clearImageLoadTimeout() {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  }

  return (
    <article className="flex flex-col gap-3">
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-ink/4">
        {product.imageUrl && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote OFF
          // images aren't configured in next.config.ts; a plain <img> avoids
          // needing to touch Module 0's build config for this module.
          <img
            src={product.imageUrl}
            alt={name}
            className="max-h-full max-w-full object-contain"
            onLoad={clearImageLoadTimeout}
            onError={() => {
              clearImageLoadTimeout();
              setImageFailed(true);
            }}
          />
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
      <NutrimentsPanel product={product} locale={locale} subscriptionActive={subscriptionActive} />
    </article>
  );
}
