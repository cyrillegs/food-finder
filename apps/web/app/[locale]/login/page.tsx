import { setRequestLocale } from 'next-intl/server';
import { LoginForm } from '@/components/auth/LoginForm';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function LoginPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <LoginForm />;
}
