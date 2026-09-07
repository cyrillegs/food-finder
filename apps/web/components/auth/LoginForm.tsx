'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from './AuthProvider';

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

      <label className="flex flex-col gap-1.5 text-sm text-ink">
        {t('passwordLabel')}
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="border-b border-ink/30 bg-transparent px-1 py-2 text-base text-ink focus:border-ink focus:outline-none"
        />
      </label>

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
