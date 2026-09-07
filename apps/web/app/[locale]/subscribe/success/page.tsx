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
    <section style={{ maxWidth: 480, margin: '2rem auto', textAlign: 'center' }}>
      <h1>{t('heading')}</h1>
      <p>{t('body')}</p>
      <Link href={`/${locale}`}>{t('backToSearchLabel')}</Link>
    </section>
  );
}
