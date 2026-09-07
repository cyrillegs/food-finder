'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { createCheckoutSession } from '@/lib/api-client';
import { useAuth } from '@/components/auth/AuthProvider';

type SubscribeButtonProps = {
  locale: string;
};

// Per the plan: a plain redirect to the Checkout Session URL, no
// Stripe.js/publishable key involved. The logged-in user's subscription
// status only actually changes once the webhook fires (see
// apps/api/src/modules/subscriptions/webhook.route.ts) - this component's
// job ends at getting them to Stripe's hosted page.
//
// Checkout now requires a logged-in user (the API 401s otherwise - there's
// no User row to attach a subscription to for an anonymous visitor). Rather
// than let that round-trip to a 401 and show a generic error, this checks
// auth state up front (via AuthProvider, already resolved once on page
// load) and renders as a plain link to the login page instead, using the
// same visual treatment so it doesn't read as a different kind of control.
export function SubscribeButton({ locale }: SubscribeButtonProps) {
  const t = useTranslations('subscriptions');
  const { user } = useAuth();
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

  // The subscribe CTA: one of the very few places `accent` appears in the
  // whole app, reserved for active/unlocked states per the design system -
  // deliberately not reused for hover states or chrome elsewhere. An
  // outline treatment rather than a solid fill: every unsubscribed search
  // result renders one of these, so a solid block repeated down the whole
  // grid would make the "one scarce color" rule meaningless in practice.
  // The outline keeps accent as the only color used here while staying
  // quiet at that repetition; the fill reserved for the hover/press moment.
  const buttonClassName =
    'inline-block border border-accent px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-paper disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-accent';

  if (!user) {
    return (
      <Link href={`/${locale}/login`} className={buttonClassName}>
        {t('subscribeLoginPromptLabel')}
      </Link>
    );
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={isLoading} className={buttonClassName}>
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
