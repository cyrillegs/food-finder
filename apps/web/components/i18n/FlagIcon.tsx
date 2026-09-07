import type { Locale } from '@/i18n/routing';

const COMMON_CLASSNAME = 'h-[15px] w-5 shrink-0 rounded-[1px] outline outline-1 -outline-offset-1 outline-ink/10';

// Simplified but recognizable flags as SVG, not Unicode flag emoji: the
// regional-indicator emoji pairs (e.g. U+1F1EC U+1F1E7 for GB) don't render
// as pictures on Windows - Segoe UI Emoji falls back to showing the plain
// two-letter country code as text instead, which read as a rendering bug
// rather than a flag (confirmed live). SVG renders identically everywhere.
export function FlagIcon({ locale }: { locale: Locale }) {
  switch (locale) {
    case 'en':
      return (
        <svg viewBox="0 0 60 30" className={COMMON_CLASSNAME} aria-hidden="true">
          <rect width="60" height="30" fill="#00247d" />
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#cf142b" strokeWidth="2" />
          <path d="M30,0 V30 M0,15 H60" stroke="#fff" strokeWidth="10" />
          <path d="M30,0 V30 M0,15 H60" stroke="#cf142b" strokeWidth="6" />
        </svg>
      );
    case 'nl':
      return (
        <svg viewBox="0 0 60 40" className={COMMON_CLASSNAME} aria-hidden="true">
          <rect width="60" height="40" fill="#21468b" />
          <rect width="60" height="26.67" fill="#fff" />
          <rect width="60" height="13.33" fill="#ae1c28" />
        </svg>
      );
    case 'de':
      return (
        <svg viewBox="0 0 60 40" className={COMMON_CLASSNAME} aria-hidden="true">
          <rect width="60" height="40" fill="#ffce00" />
          <rect width="60" height="26.67" fill="#dd0000" />
          <rect width="60" height="13.33" fill="#000" />
        </svg>
      );
    case 'fr':
      return (
        <svg viewBox="0 0 60 40" className={COMMON_CLASSNAME} aria-hidden="true">
          <rect width="60" height="40" fill="#fff" />
          <rect width="20" height="40" fill="#0055a4" />
          <rect x="40" width="20" height="40" fill="#ef4135" />
        </svg>
      );
  }
}
