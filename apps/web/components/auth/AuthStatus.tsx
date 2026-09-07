'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useAuth } from './AuthProvider';

type AuthStatusProps = {
  locale: string;
};

// Header affordance, next to the language switcher (see
// app/[locale]/layout.tsx): a "Log in" link when logged out, or the current
// user's email plus a "Log out" button when logged in. Nothing is rendered
// while the initial auth check is still in flight - a brief blank slot
// reads calmer than flashing "Log in" and then immediately swapping to an
// email, which would happen on every page load for an already-logged-in
// visitor.
export function AuthStatus({ locale }: AuthStatusProps) {
  const t = useTranslations('auth');
  const { user, isLoading, logout } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!user) {
    return (
      <Link href={`/${locale}/login`} className="text-sm font-medium text-ink underline underline-offset-4">
        {t('loginLinkLabel')}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted">{user.email}</span>
      <button
        type="button"
        onClick={() => void logout()}
        className="font-medium text-ink underline underline-offset-4"
      >
        {t('logoutLabel')}
      </button>
    </div>
  );
}
