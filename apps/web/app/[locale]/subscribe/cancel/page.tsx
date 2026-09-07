import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';

type Props = {
  params: Promise<{ locale: string }>;
};

// Reached when the demo user backs out of Stripe Checkout. No subscription
// was created, so there's nothing to sync - just acknowledge the cancellation
// and send them back to search, where they can try SubscribeButton again.
export default async function SubscribeCancelPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'subscriptions.cancelPage' });

  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
      <h1 className="font-display text-3xl font-medium text-ink">{t('heading')}</h1>
      <p className="text-base text-muted">{t('body')}</p>
      <Link href={`/${locale}`} className="mt-2 text-sm font-medium text-ink underline underline-offset-4">
        {t('backToSearchLabel')}
      </Link>
    </section>
  );
}
