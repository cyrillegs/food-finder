import { test, expect, type Page } from '@playwright/test';

// Real-browser coverage for the login/multi-user module: logging in and out
// with the seeded demo accounts, the "log in to ..." prompts Subscribe and
// Recent Searches show when logged out, and - the actual point of this
// whole change - that two different logged-in users see separate Recent
// Searches histories rather than one shared list.
//
// Needs only the local dev stack (`docker compose up` + apps/api's dev
// server + apps/web's dev server, with the seed script already run against
// it) - no Stripe/production dependency - so, like locale-switching.spec.ts
// and recent-searches.spec.ts, this is safe to run locally even though it
// isn't wired into `.github/workflows/ci.yml` (same reasoning as those two:
// standing up MySQL + both dev servers inside that workflow is out of scope
// here).
//
// Credentials match apps/api/prisma/seed.ts. Recent Searches accumulates
// real history for these accounts across runs (the seed is idempotent, it
// never clears RecentSearch rows), so the cross-user isolation test below
// uses a per-run nonce query rather than assuming either account starts
// with empty history - the same discipline recent-searches.spec.ts follows.
//
// Run manually: `docker compose up -d`, `npm run dev` in apps/api, `npm run
// dev` in apps/web, `npx prisma db seed` in apps/api (if not already
// seeded), then from apps/web: `npm run test:e2e -- e2e/login.spec.ts`.

const DEMO1 = { email: 'demo1@food-finder.local', password: 'FoodFinderDemo!2026' };
const DEMO2 = { email: 'demo2@food-finder.local', password: 'FoodFinderDemo!2026' };

const SEARCH_HEADING = 'Find a food product';
const SEARCH_SUBMIT = 'Search';
const RECENT_SEARCHES_LABEL = 'Recent searches';

function nonce(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

async function login(page: Page, creds: { email: string; password: string }) {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(creds.email);
  await page.getByLabel('Password').fill(creds.password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL(/\/en$/);
  await expect(page.getByText(creds.email)).toBeVisible();
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('link', { name: 'Log in', exact: true })).toBeVisible();
}

test('logged out: Subscribe and Recent Searches both prompt login instead of their normal behavior', async ({ page }) => {
  await page.goto('/en');

  await expect(page.getByText('Log in to see your search history.')).toBeVisible();

  const searchbox = page.getByRole('searchbox', { name: SEARCH_HEADING });
  await searchbox.fill('nutella');
  await page.getByRole('button', { name: SEARCH_SUBMIT, exact: true }).click();
  await expect(page.getByRole('link', { name: 'Log in to unlock nutrition info' }).first()).toBeVisible({ timeout: 15_000 });
});

test('logging in with valid credentials switches the header to the logged-in state', async ({ page }) => {
  await login(page, DEMO1);
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
});

test('a wrong password shows a generic error and does not log in', async ({ page }) => {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(DEMO1.email);
  await page.getByLabel('Password').fill('definitely-the-wrong-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password.' })).toBeVisible();
  await expect(page).toHaveURL(/\/en\/login$/);
});

// Same generic error/no-redirect for an email that isn't one of the 5
// seeded accounts - proving the response doesn't distinguish "wrong
// password for a real account" from "no such account" is really a backend
// concern (see apps/api/src/modules/auth/auth.test.ts), but this confirms
// the frontend doesn't introduce its own distinction either (e.g. a
// different message, or treating one case as a redirect).
test('an unknown email shows the same generic error as a wrong password', async ({ page }) => {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill('nobody@food-finder.local');
  await page.getByLabel('Password').fill(DEMO1.password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password.' })).toBeVisible();
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('logging out returns to the logged-out state', async ({ page }) => {
  await login(page, DEMO1);
  await logout(page);
});

// The actual point of this whole module: two different accounts must never
// share Recent Searches history.
//
// `exact: true` on the entry lookups below matters: each entry's delete
// button carries an aria-label like `Remove "<query>" from recent
// searches`, which substring-matches `{ name: demo1Query }` under
// Playwright's default non-exact matching once that query text appears
// inside the delete button's own label too - resolving to two elements
// instead of one.
test('two different logged-in users see separate Recent Searches histories', async ({ page }) => {
  const demo1Query = nonce('demo1-only');
  const demo2Query = nonce('demo2-only');
  const panel = page.getByRole('region', { name: RECENT_SEARCHES_LABEL });

  await login(page, DEMO1);
  const searchbox = page.getByRole('searchbox', { name: SEARCH_HEADING });
  await searchbox.fill(demo1Query);
  await page.getByRole('button', { name: SEARCH_SUBMIT, exact: true }).click();
  await expect(panel.getByRole('button', { name: demo1Query, exact: true })).toBeVisible({ timeout: 15_000 });

  await logout(page);
  await login(page, DEMO2);

  // Demo2 runs its OWN search first, and we wait for that entry to appear,
  // before asserting demo1's query is absent. Without this the absence check
  // is vacuous: straight after login the panel renders empty while demo2's
  // GET /api/searches/recent is still in flight, so `toHaveCount(0)` passes
  // against a panel that simply hasn't loaded yet - it would still pass if
  // the API were leaking demo1's history to demo2, which is the single thing
  // this test exists to rule out. Waiting for demo2's own entry proves the
  // panel is populated with demo2's real, loaded history at the moment the
  // absence is checked.
  await searchbox.fill(demo2Query);
  await page.getByRole('button', { name: SEARCH_SUBMIT, exact: true }).click();
  await expect(panel.getByRole('button', { name: demo2Query, exact: true })).toBeVisible({ timeout: 15_000 });

  await expect(panel.getByRole('button', { name: demo1Query, exact: true })).toHaveCount(0);
});
