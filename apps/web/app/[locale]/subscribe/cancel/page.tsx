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
    <section style={{ maxWidth: 480, margin: '2rem auto', textAlign: 'center' }}>
      <h1>{t('heading')}</h1>
      <p>{t('body')}</p>
      <Link href={`/${locale}`}>{t('backToSearchLabel')}</Link>
    </section>
  );
}
