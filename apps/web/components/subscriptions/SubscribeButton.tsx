'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { createCheckoutSession } from '@/lib/api-client';

type SubscribeButtonProps = {
  locale: string;
};

// Per the plan: a plain redirect to the Checkout Session URL, no
// Stripe.js/publishable key involved. The demo user's subscription status
// only actually changes once the webhook fires (see
// apps/api/src/modules/subscriptions/webhook.route.ts) - this component's
// job ends at getting them to Stripe's hosted page.
export function SubscribeButton({ locale }: SubscribeButtonProps) {
  const t = useTranslations('subscriptions');
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  async function handleClick() {
    setIsLoading(true);
    setHasError(false);
    try {
      const url = await createCheckoutSession(locale);
      window.location.href = url;
    } catch (err) {
      console.error('Failed to start checkout:', err);
      setHasError(true);
      setIsLoading(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={isLoading} style={{ padding: '0.4rem 0.9rem' }}>
        {isLoading ? t('startingCheckoutLabel') : t('subscribeButtonLabel')}
      </button>
      {hasError && (
        <p role="alert" style={{ color: '#b00020', fontSize: '0.85rem', marginTop: '0.35rem' }}>
          {t('checkoutErrorMessage')}
        </p>
      )}
    </div>
  );
}
