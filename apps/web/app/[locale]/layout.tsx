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

// Localized per request, so a link shared from /fr previews in French.
// The icon and the social-preview image themselves come from the
// app/icon.svg and app/opengraph-image.png file conventions - Next injects
// the tags for those automatically, so they are deliberately not repeated
// here. The OG image is a pre-rendered static PNG rather than a next/og
// ImageResponse: nothing then has to load fonts or run an image renderer in
// the request path of a deployed container.
//
// metadataBase resolves the relative OG image path to an absolute URL, which
// scrapers require. NEXT_PUBLIC_API_BASE_URL is the API's origin, not the
// site's, so it can't be reused here; falling back to localhost keeps dev
// working and only affects preview cards, never the app itself.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });
  const title = t('title');
  const description = t('description');
  // `||`, not `??`: a build that receives the ARG unset comes through as an
  // empty string, not undefined, and `new URL('')` throws ERR_INVALID_URL -
  // which crashed the production build outright the first time this shipped
  // (Dokploy runs its own build from a fresh clone with its own configured
  // build-args, separate from CI's docker build step - so a build-arg added
  // only to the CI workflow doesn't reach it). Same class of bug as the
  // CORS_ORIGIN fallback fixed for the same reason.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  return {
    metadataBase: new URL(siteUrl),
    title,
    description,
    openGraph: {
      type: 'website',
      siteName: title,
      title,
      description,
      locale,
      url: `${siteUrl}/${locale}`,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
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
