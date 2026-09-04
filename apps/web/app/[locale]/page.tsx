import { setRequestLocale } from 'next-intl/server';
import { SearchExperience } from '@/components/search/SearchExperience';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <SearchExperience locale={locale} />;
}
