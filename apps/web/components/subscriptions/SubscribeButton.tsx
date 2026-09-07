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
      {/* The subscribe CTA: one of the very few places `accent` appears in
          the whole app, reserved for active/unlocked states per the design
          system - deliberately not reused for hover states or chrome
          elsewhere. */}
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        className="bg-accent px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading ? t('startingCheckoutLabel') : t('subscribeButtonLabel')}
      </button>
      {hasError && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {t('checkoutErrorMessage')}
        </p>
      )}
    </div>
  );
}
