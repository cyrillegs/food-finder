'use client';

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { hasLocale, useLocale, useTranslations } from 'next-intl';
import { routing, type Locale } from '@/i18n/routing';
import { usePathname, useRouter } from '@/i18n/navigation';
import { FlagIcon } from './FlagIcon';

// Manual locale selector per the assignment brief ("support English, Dutch,
// German, and French through a manual language selector"). Uses next-intl's
// documented "changing locale for the current page" recipe: combine the
// locale-aware `usePathname`/`useRouter` from i18n/navigation.ts so
// switching locale keeps the user on the same page (e.g. `/fr/subscribe/
// success` -> `/de/subscribe/success`) instead of always bouncing to the
// home page. This app doesn't use next-intl's `pathnames` config (routes
// aren't translated per-locale), so no `params`/`pathname` object form is
// needed - passing the plain pathname string is sufficient.
//
// A custom listbox rather than a native <select>: a native <option> can
// only render text, never an <img>/SVG, and Unicode flag emoji don't
// render as pictures on Windows (see FlagIcon.tsx) - so getting a real
// flag icon next to each language name at all requires building the
// dropdown by hand. Implements the WAI-ARIA "select-only combobox"
// pattern: a button that owns the visible current value, toggling a
// role="listbox" of role="option"s, with roving focus between them.
// Survives the remount that a locale change causes. Switching locale
// navigates between `[locale]` route segments, so React tears down this
// component and builds a fresh one - the button that had focus is a dead DOM
// node by the time the new tree renders, and focus lands on <body>. Calling
// focus() inside commit() therefore cannot work on its own; the intent has
// to outlive the unmount. Module scope does that (client-side navigation
// keeps the module loaded) without reaching for sessionStorage, and it
// resets naturally on a full page load, so arriving directly at /de never
// steals focus.
let pendingFocusRestore = false;

export function LanguageSwitcher() {
  const t = useTranslations('languageSwitcher');
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => routing.locales.indexOf(locale));
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const labelId = useId();
  // Derived from useId rather than a hardcoded string: two switchers on one
  // page (e.g. a header and a footer copy) would otherwise emit duplicate
  // DOM ids, and aria-labelledby would resolve to whichever one came first.
  const valueId = `${labelId}-value`;

  // Closes on an outside click - the listbox isn't a native popover, so
  // nothing does this automatically.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  // Moves DOM focus onto the active option whenever the listbox opens or
  // the active option changes - the roving-tabindex half of the pattern.
  useEffect(() => {
    if (open) {
      optionRefs.current[activeIndex]?.focus();
    }
  }, [open, activeIndex]);

  // Re-focuses the trigger on the far side of a locale change (see
  // pendingFocusRestore above), so a keyboard user who just switched
  // language keeps their place instead of being dropped back to <body>.
  useEffect(() => {
    if (pendingFocusRestore) {
      pendingFocusRestore = false;
      buttonRef.current?.focus();
    }
  }, []);

  function openListbox() {
    setActiveIndex(routing.locales.indexOf(locale));
    setOpen(true);
  }

  function commit(nextLocale: string) {
    setOpen(false);
    buttonRef.current?.focus();
    if (!hasLocale(routing.locales, nextLocale) || nextLocale === locale) {
      return;
    }
    // The focus() above only holds until this navigation remounts the
    // component; the flag is what carries the intent across that boundary.
    pendingFocusRestore = true;
    startTransition(() => {
      router.replace(pathname, { locale: nextLocale });
    });
  }

  function handleButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openListbox();
    }
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLLIElement>, index: number) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, routing.locales.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(routing.locales.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        commit(routing.locales[index]);
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        break;
      case 'Tab':
        // Move focus back to the trigger BEFORE closing, without preventing
        // the default. Closing alone would unmount the focused <li> out from
        // under the browser mid-keypress, which drops focus to <body> and
        // restarts tab order at the top of the page. Handing focus to the
        // button first means the browser's own Tab traversal continues from
        // the switcher, which is where the user actually was.
        buttonRef.current?.focus();
        setOpen(false);
        break;
    }
  }

  return (
    <div className="inline-flex items-center gap-2 text-sm text-muted">
      <span id={labelId}>{t('label')}</span>
      <div ref={containerRef} className="relative">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${labelId} ${valueId}`}
          data-testid="language-switcher"
          data-current-locale={locale}
          // `aria-busy` rather than `disabled` during the locale transition:
          // commit() deliberately returns focus to this button, and
          // disabling it immediately afterwards makes the browser blur it,
          // dumping focus onto <body> after every language switch. Staying
          // enabled keeps focus where the user left it; a repeat click
          // during the transition just re-navigates to the same place.
          aria-busy={isPending}
          onClick={() => (open ? setOpen(false) : openListbox())}
          onKeyDown={handleButtonKeyDown}
          className={`flex items-center gap-2 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink transition-opacity focus:border-ink focus:outline-none ${
            isPending ? 'opacity-60' : ''
          }`}
        >
          <FlagIcon locale={locale} />
          <span id={valueId}>{t(`languageNames.${locale}`)}</span>
          <span aria-hidden="true" className="text-muted">
            ▾
          </span>
        </button>
        {open ? (
          <ul
            role="listbox"
            aria-labelledby={labelId}
            tabIndex={-1}
            className="absolute right-0 z-10 mt-1 min-w-full border border-ink/20 bg-paper py-1 shadow-sm"
          >
            {routing.locales.map((loc, index) => (
              <li
                key={loc}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                role="option"
                aria-selected={loc === locale}
                data-locale={loc}
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => commit(loc)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 text-ink outline-none ${
                  index === activeIndex ? 'bg-ink/5' : ''
                } hover:bg-ink/5`}
              >
                <FlagIcon locale={loc} />
                <span>{t(`languageNames.${loc}`)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
