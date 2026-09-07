import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';

type Props = {
  params: Promise<{ locale: string }>;
};

// Gating is enforced entirely through the Search response (see
// apps/api's subscriptions.gate.ts) - there's no separate "subscribed?"
// flag for this page to poll or refetch. "Refetch status on return" just
// means: the next search this demo user makes will naturally reflect the
// new DemoUser.subscriptionStatus, because the API re-checks it on every
// request. So this page only needs to confirm success and send the user
// back to search - nothing more to build here.
export default async function SubscribeSuccessPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'subscriptions.successPage' });

  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
      {/* Small decorative dot in `accent` - the active-subscription
          indicator called for in the design system, kept as a plain
          decoration rather than coloring part of the heading text. */}
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent" />
      <h1 className="font-display text-3xl font-medium text-ink">{t('heading')}</h1>
      <p className="text-base text-muted">{t('body')}</p>
      <Link href={`/${locale}`} className="mt-2 text-sm font-medium text-ink underline underline-offset-4">
        {t('backToSearchLabel')}
      </Link>
    </section>
  );
}
