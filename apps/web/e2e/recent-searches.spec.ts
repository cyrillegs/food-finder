import { test, expect } from '@playwright/test';

// Real-browser coverage for Module 5 (Recent Searches): search, see the
// query appear in the panel; search again and see both, newest first;
// click an older entry and confirm it actually re-runs that search (not
// just refills the input); confirm re-running the same query back-to-back
// doesn't duplicate the entry; confirm the panel never exceeds 10 entries;
// confirm the per-entry delete button removes only that entry.
// This is the flow the module's build brief explicitly calls out as a
// reasonable fit for the same real-browser treatment Module 4 set with
// e2e/locale-switching.spec.ts.
//
// Like that suite, this needs only the local dev stack (`docker compose up`
// + apps/api's dev server + apps/web's dev server) - no Stripe/production
// dependency - so it's safe to write and run locally even though it isn't
// wired into `.github/workflows/ci.yml` (same reasoning as
// locale-switching.spec.ts: doing so would mean standing up MySQL and both
// dev servers inside that workflow, out of scope for this module).
//
// Unlike a Subscriptions User row, which prior modules were careful to
// reset between runs, RecentSearch rows are meant to accumulate - so every
// assertion here uses a per-run unique query string (a nonce token) rather
// than assuming the panel starts empty or asserting on its exact contents.
// This suite has to coexist with whatever history already exists in the
// local dev database.
//
// The nonce queries are gibberish on purpose: Open Food Facts legitimately
// returns zero results for them, which is still a real, loggable search per
// the API's own rule (a zero-result search is logged; a request that never
// reached OFF is not) - and it keeps every search in this suite fast
// regardless of how much of the real product catalog OFF would otherwise
// have to search through.
//
// Run manually the same way apps/web's other e2e suite is: `docker compose
// up -d`, `npm run dev` in apps/api, `npm run dev` in apps/web, `npx prisma
// db seed` in apps/api (if not already seeded), then from apps/web: `npm
// run test:e2e -- e2e/recent-searches.spec.ts`.
//
// GET /api/searches/recent now requires a logged-in user (see the
// login/multi-user module's PR description) - every test here logs in
// first via `demo3@food-finder.local` (apps/api/prisma/seed.ts), a
// different seeded account than e2e/login.spec.ts uses, so this suite's
// accumulated history doesn't interact with that one's assertions.
// Anonymous-visitor coverage (locked out of this panel entirely) lives in
// login.spec.ts, not duplicated here.

const HEADING = 'Find a food product';
const SUBMIT = 'Search';
const PANEL_LABEL = 'Recent searches';
const DEMO_ACCOUNT = { email: 'demo3@food-finder.local', password: 'FoodFinderDemo!2026' };

function nonce(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

async function login(page: import('@playwright/test').Page) {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(DEMO_ACCOUNT.email);
  await page.getByLabel('Password').fill(DEMO_ACCOUNT.password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL(/\/en$/);
}

// Scoped to the panel and, critically, `exact: true` - each entry now
// renders two buttons (select the query, delete the entry), and the
// delete button's accessible name is `Remove "<query>" from recent
// searches` which otherwise substring-matches `{ name: query }` under
// Playwright's default (non-exact) name matching, turning single-element
// lookups into strict-mode violations.
function entryButton(page: import('@playwright/test').Page, query: string) {
  return page.getByRole('region', { name: PANEL_LABEL }).getByRole('button', { name: query, exact: true });
}

// All the query-select buttons in the panel, excluding the per-entry
// delete buttons (visible text "×") - used by tests that count or
// list every entry rather than looking up one by name.
function entryButtons(page: import('@playwright/test').Page) {
  return page.getByRole('region', { name: PANEL_LABEL }).getByRole('button').filter({ hasNotText: '×' });
}

async function runSearch(page: import('@playwright/test').Page, query: string) {
  const searchbox = page.getByRole('searchbox', { name: HEADING });
  const submit = page.getByRole('button', { name: SUBMIT, exact: true });
  await searchbox.fill(query);
  await submit.click();
  await expect(entryButton(page, query)).toBeVisible({ timeout: 15_000 });
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('a completed search appears in the Recent Searches panel', async ({ page }) => {
  const query = nonce('appears');

  await runSearch(page, query);
});

test('a second search shows both entries, newest first', async ({ page }) => {
  const first = nonce('first');
  const second = nonce('second');

  await page.goto('/en');
  await runSearch(page, first);
  await runSearch(page, second);

  const texts = await entryButtons(page).evaluateAll((buttons) => buttons.map((b) => b.textContent));
  const firstIndex = texts.indexOf(first);
  const secondIndex = texts.indexOf(second);

  expect(firstIndex).toBeGreaterThanOrEqual(0);
  expect(secondIndex).toBeGreaterThanOrEqual(0);
  expect(secondIndex).toBeLessThan(firstIndex); // second (newer) sorts before first
});

test('clicking an older recent search actually re-runs it, not just refills the box', async ({ page }) => {
  const older = nonce('older');
  const newer = nonce('newer');

  await page.goto('/en');
  await runSearch(page, older);
  await runSearch(page, newer);

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes('/api/search') && res.url().includes(encodeURIComponent(older)),
      { timeout: 15_000 },
    ),
    entryButton(page, older).click(),
  ]);

  // A real GET /api/search?q=<older> request firing (and succeeding) in
  // response to the click - not just the button's visible text changing -
  // is the actual proof this re-ran the search rather than only refilling
  // the search box.
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).searchParams.get('q')).toBe(older);
});

test('re-running the same search back-to-back does not duplicate the entry', async ({ page }) => {
  const query = nonce('dedup');

  await page.goto('/en');
  await runSearch(page, query);

  // Click the entry that was just created (re-running the identical query)
  // rather than retyping it - the "click a recent entry that's already the
  // top entry" dedup case from recent-searches.service.ts's recordSearch.
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes('/api/search') && res.url().includes(encodeURIComponent(query)),
      { timeout: 15_000 },
    ),
    entryButton(page, query).click(),
  ]);
  expect(response.status()).toBe(200);

  await expect(entryButton(page, query)).toHaveCount(1);
});

test('the panel never shows more than 10 entries', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/en');

  const queries = Array.from({ length: 11 }, (_, i) => nonce(`cap-${i}`));
  for (const query of queries) {
    await runSearch(page, query);
  }

  await expect(entryButtons(page)).toHaveCount(10);

  // The very first of these 11 searches was pushed out of the capped
  // top-10 window by the other 10 (this suite's own searches alone are
  // enough to prove the cap, regardless of any other pre-existing history).
  await expect(entryButton(page, queries[0])).toHaveCount(0);
});

test('the delete button removes just that one entry and leaves the rest', async ({ page }) => {
  const keep = nonce('keep');
  const remove = nonce('remove');

  await page.goto('/en');
  await runSearch(page, keep);
  await runSearch(page, remove);

  const removeButtonLabel = new RegExp(`Remove.*${remove}`);
  await page.getByRole('region', { name: PANEL_LABEL }).getByRole('button', { name: removeButtonLabel }).click();

  await expect(entryButton(page, remove)).toHaveCount(0);
  await expect(entryButton(page, keep)).toHaveCount(1);
});
