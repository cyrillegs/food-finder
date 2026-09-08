'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from './AuthProvider';

// Hand-drawn, not an icon library dependency - matches FlagIcon.tsx's own
// precedent (this app reaches for a plain inline SVG over a new package for
// a couple of small icons). The open eye shows when the password is
// currently hidden (clicking it reveals); the slashed eye shows once
// revealed (clicking it hides again) - the icon always depicts the action
// a click will take, not the current state, which is the common convention
// for this kind of toggle.
function EyeIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.5" />
      <path d="M2.5 2.5l15 15" strokeLinecap="round" />
    </svg>
  );
}

// The only account-entry UI this app has - no registration, no "forgot
// password" (see the PR description's scope note): 5 accounts are
// pre-seeded (apps/api/prisma/seed.ts), not self-service signup. On success,
// sends the visitor back to search, where SubscribeButton/RecentSearchesPanel
// now reflect the logged-in state via AuthProvider.
export function LoginForm() {
  const t = useTranslations('auth');
  const { login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setHasError(false);
    try {
      await login(email, password);
      router.push('/');
    } catch (err) {
      console.error('Login failed:', err);
      setHasError(true);
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-6 py-16">
      <h1 className="font-display text-3xl font-medium text-ink">{t('heading')}</h1>

      <label className="flex flex-col gap-1.5 text-sm text-ink">
        {t('emailLabel')}
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="border-b border-ink/30 bg-transparent px-1 py-2 text-base text-ink focus:border-ink focus:outline-none"
        />
      </label>

      <div className="flex flex-col gap-1.5 text-sm text-ink">
        {/* Explicit htmlFor/id, not a wrapping <label>: the toggle button
            below has to sit alongside the input as a plain sibling, not
            nested inside the same <label> - a label containing more than
            one interactive element makes browsers concatenate everything
            inside it (input's own text plus the button's aria-label) into
            one ambiguous accessible name for the input, confirmed live via
            a strict-mode Playwright failure ("Password" resolved to both
            the input and the button, since the button's own label contains
            the word "Password" as a substring). Explicit association keeps
            the input's accessible name exactly "Password", nothing else. */}
        <label htmlFor="login-password">{t('passwordLabel')}</label>
        <span className="relative flex items-center">
          <input
            id="login-password"
            type={isPasswordVisible ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full border-b border-ink/30 bg-transparent px-1 py-2 pr-8 text-base text-ink focus:border-ink focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setIsPasswordVisible((visible) => !visible)}
            aria-label={isPasswordVisible ? t('hidePasswordLabel') : t('showPasswordLabel')}
            className="absolute right-0 flex items-center justify-center text-muted transition-colors hover:text-ink focus:outline-none"
          >
            {isPasswordVisible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </span>
      </div>

      {hasError && (
        <p role="alert" className="text-sm text-red-700">
          {t('loginErrorMessage')}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="border border-accent px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-paper disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-accent"
      >
        {isSubmitting ? t('loggingInLabel') : t('submitLabel')}
      </button>
    </form>
  );
}
