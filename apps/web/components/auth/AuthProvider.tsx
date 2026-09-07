'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getCurrentUser, login as apiLogin, logout as apiLogout, type CurrentUser } from '@/lib/api-client';

type AuthContextValue = {
  // undefined while the initial GET /api/auth/me call is in flight (see
  // isLoading), null once resolved and there's no logged-in user, or the
  // user object once there is one. Consumers that only care about "logged
  // in or not" can just check truthiness; components that need to
  // distinguish "still checking" from "definitely logged out" (to avoid a
  // flash of logged-out UI on load) use isLoading.
  user: CurrentUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Wraps the app (see app/[locale]/layout.tsx) so auth state is resolved
// once, on mount, and shared everywhere it's needed: the header's
// login/logout control, SubscribeButton's "log in to subscribe" prompt, and
// SearchExperience's decision whether to even ask for recent searches.
// Session mechanism itself lives entirely server-side (an httpOnly cookie
// the API sets/reads) - this component only ever mirrors what
// GET /api/auth/me reports, it never reads or writes the cookie directly.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const current = await getCurrentUser();
        if (!cancelled) {
          setUser(current);
        }
      } catch (err) {
        console.error('Failed to load current user:', err);
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const loggedInUser = await apiLogin(email, password);
    setUser(loggedInUser);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, isLoading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
