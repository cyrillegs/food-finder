import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Locale-aware wrappers around Next.js' navigation APIs, scoped to this
// app's routing config. `usePathname` here returns the pathname *without*
// the `[locale]` segment (e.g. `/subscribe/success` on both `/en/subscribe/
// success` and `/fr/subscribe/success`), which is exactly what
// LanguageSwitcher needs to jump to the same page under a different locale
// via `useRouter().replace(pathname, { locale })` - see
// components/i18n/LanguageSwitcher.tsx.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
