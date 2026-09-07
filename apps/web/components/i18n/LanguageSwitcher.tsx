'use client';

import { type ChangeEvent, useTransition } from 'react';
import { hasLocale, useLocale, useTranslations } from 'next-intl';
import { routing } from '@/i18n/routing';
import { usePathname, useRouter } from '@/i18n/navigation';

// Flags are presentational only (not translated content, hence not in
// messages/*.json) - a plain emoji character renders fine as <option> text
// across browsers, unlike an <img>/SVG, which native <option> elements
// don't reliably render at all.
const LOCALE_FLAGS: Record<string, string> = {
  en: '🇬🇧',
  nl: '🇳🇱',
  de: '🇩🇪',
  fr: '🇫🇷',
};

// Manual locale selector per the assignment brief ("support English, Dutch,
// German, and French through a manual language selector"). Uses next-intl's
// documented "changing locale for the current page" recipe: combine the
// locale-aware `usePathname`/`useRouter` from i18n/navigation.ts so
// switching locale keeps the user on the same page (e.g. `/fr/subscribe/
// success` -> `/de/subscribe/success`) instead of always bouncing to the
// home page. This app doesn't use next-intl's `pathnames` config (routes
// aren't translated per-locale), so no `params`/`pathname` object form is
// needed - passing the plain pathname string is sufficient.
export function LanguageSwitcher() {
  const t = useTranslations('languageSwitcher');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextLocale = event.target.value;
    if (!hasLocale(routing.locales, nextLocale) || nextLocale === locale) {
      return;
    }
    startTransition(() => {
      router.replace(pathname, { locale: nextLocale });
    });
  }

  return (
    <label className="inline-flex items-center gap-2 text-sm text-muted">
      <span>{t('label')}</span>
      <select
        value={locale}
        onChange={handleChange}
        disabled={isPending}
        aria-label={t('label')}
        data-testid="language-switcher"
        className="border border-ink/20 bg-paper px-2 py-1 text-sm text-ink focus:border-ink focus:outline-none disabled:opacity-60"
      >
        {routing.locales.map((loc) => (
          <option key={loc} value={loc}>
            {LOCALE_FLAGS[loc]} {t(`languageNames.${loc}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
