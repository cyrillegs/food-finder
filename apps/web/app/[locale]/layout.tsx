import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Fraunces, IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import { routing } from '@/i18n/routing';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { AuthStatus } from '@/components/auth/AuthStatus';
import type { ReactNode } from 'react';
import '../globals.css';

// Self-hosted at build time via next/font (not a runtime Google Fonts
// <link>), each exposing a CSS variable that app/globals.css's
// `@theme inline` block wires into Tailwind's font-display/font-sans/
// font-mono utilities. Explicit `weight` arrays are used for all three
// (rather than relying on next/font's variable-font auto-detection) so the
// loaded weights are deterministic regardless of which of these happen to
// ship a variable axis in next/font's Google Fonts metadata.
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-fraunces',
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });
  return {
    title: t('title'),
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Enable static rendering for this locale.
  setRequestLocale(locale);

  return (
    <html lang={locale} className={`${fraunces.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable}`}>
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        <NextIntlClientProvider>
          <AuthProvider>
            <header className="mx-auto flex max-w-5xl items-center justify-between border-b border-ink/10 px-4 py-6 sm:px-6 lg:px-8">
              <strong className="font-display text-xl font-medium tracking-tight text-ink sm:text-2xl">
                Food Finder
              </strong>
              <div className="flex items-center gap-4">
                <AuthStatus locale={locale} />
                <LanguageSwitcher />
              </div>
            </header>
            <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">{children}</main>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
