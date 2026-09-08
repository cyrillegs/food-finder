import { test, expect, type Page } from '@playwright/test';

// The switcher is a custom listbox (see components/i18n/LanguageSwitcher.tsx
// - a native <select>'s <option> can't render the flag icons), so this
// suite drives it like a real user would (open, click an option) rather
// than Playwright's `selectOption()`/`toHaveValue()`, which only work on an
// actual <select> element.
async function selectLocale(page: Page, targetLocale: string) {
  await page.getByTestId('language-switcher').click();
  await page.locator(`[role="option"][data-locale="${targetLocale}"]`).click();
}

// Real-browser coverage for Module 4 (i18n): the manual LanguageSwitcher and
// per-locale rendering, run against a real dev server doing a real search
// against the live OFF-backed API (see search.service.ts) - not mocked.
//
// Unlike e2e/subscription-flow.spec.ts, this suite needs no Stripe key and
// never touches a real deployment - it only needs the same local stack
// (`docker compose up` + `apps/api`'s dev server + this app's dev server)
// used for day-to-day development. That means, unlike the Stripe suite,
// there's no inherent reason this couldn't run in CI against a local dev
// server. It isn't wired into `.github/workflows/ci.yml` here because doing
// so would mean standing up MySQL + both dev servers in that workflow
// (apps/web's CI job currently only runs `next build`, no services, no test
// step at all) - a CI pipeline change that's out of scope for this module
// per the build brief. Flagging as a reasonable follow-up rather than
// silently copying the Stripe suite's "not part of CI" framing without
// re-checking whether it actually applies here (it doesn't, for the reason
// above).
//
// Run manually the same way the app is developed: `docker compose up -d`,
// `npm run dev` in apps/api, `npm run dev` in apps/web, then from apps/web:
// `npm run test:e2e -- e2e/locale-switching.spec.ts` (defaults to
// BASE_URL=http://localhost:3000, same pattern as playwright.config.ts).

const LOCALES = [
  { code: 'en', searchHeading: 'Find a food product', submitLabel: 'Search', successHeading: "You're subscribed!" },
  { code: 'nl', searchHeading: 'Zoek een voedingsproduct', submitLabel: 'Zoeken', successHeading: 'Je bent geabonneerd!' },
  { code: 'de', searchHeading: 'Lebensmittel suchen', submitLabel: 'Suchen', successHeading: 'Du hast abonniert!' },
  {
    code: 'fr',
    searchHeading: 'Rechercher un produit alimentaire',
    submitLabel: 'Rechercher',
    successHeading: 'Vous êtes abonné !',
  },
] as const;

for (const { code, searchHeading, submitLabel } of LOCALES) {
  test(`${code}: renders localized search UI, exposes the switcher, and returns real results`, async ({ page }) => {
    await page.goto(`/${code}`);

    // Page renders in the requested language.
    const searchbox = page.getByRole('searchbox', { name: searchHeading });
    await expect(searchbox).toBeVisible();

    // Switcher is visible and reflects the current locale, with all four
    // languages offered regardless of which one is active.
    const switcher = page.getByTestId('language-switcher');
    await expect(switcher).toBeVisible();
    await expect(switcher).toHaveAttribute('data-current-locale', code);

    await switcher.click();
    const optionLocales = await page
      .locator('[role="option"]')
      .evaluateAll((options) => options.map((option) => option.getAttribute('data-locale')).sort());
    expect(optionLocales).toEqual(['de', 'en', 'fr', 'nl']);
    await page.keyboard.press('Escape');

    // A real search against the live Search-a-licious-backed API returns
    // results - not asserting on translated product data (OFF product names
    // follow their own locale-fallback chain, verified separately against
    // the live API), just that the search round-trip actually works and
    // renders result cards in this locale's UI.
    await searchbox.fill('nutella');
    await page.getByRole('button', { name: submitLabel }).click();
    await expect(page.getByRole('article').first()).toBeVisible({ timeout: 15_000 });
  });
}

test('switching locale from a non-home page preserves the current page', async ({ page }) => {
  await page.goto('/en/subscribe/success');
  await expect(page.getByRole('heading', { name: "You're subscribed!" })).toBeVisible();

  await selectLocale(page, 'fr');
  await page.waitForURL(/\/fr\/subscribe\/success$/);
  await expect(page.getByRole('heading', { name: 'Vous êtes abonné !' })).toBeVisible();

  // And the reverse direction, from a locale other than the default back to
  // English, also lands on the equivalent page rather than bouncing home.
  await selectLocale(page, 'en');
  await page.waitForURL(/\/en\/subscribe\/success$/);
  await expect(page.getByRole('heading', { name: "You're subscribed!" })).toBeVisible();
});

test('cycles through all four locales from the home page without getting stuck', async ({ page }) => {
  await page.goto('/en');

  for (const target of ['nl', 'de', 'fr', 'en'] as const) {
    await selectLocale(page, target);
    await page.waitForURL(new RegExp(`/${target}$`));
    await expect(page.getByTestId('language-switcher')).toHaveAttribute('data-current-locale', target);
  }
});

// Keyboard/focus regressions in the hand-rolled listbox, all of which were
// real bugs at some point: a Tab out of the open list unmounted the focused
// <li> and dropped focus to <body>; committing a locale change disabled the
// button we had just focused (and, separately, the ensuing route change
// remounts the component, so focus has to be restored on the far side);
// and the value span used a hardcoded DOM id that aria-labelledby would
// resolve ambiguously if the switcher ever rendered twice.
//
// Unlike the rest of this file, these need no API/search round-trip - the
// switcher is entirely client-side.
test('keyboard focus survives opening, tabbing out of, and committing from the switcher', async ({ page }) => {
  await page.goto('/en');
  const switcher = page.getByTestId('language-switcher');

  const labelledBy = await switcher.getAttribute('aria-labelledby');
  expect(labelledBy).toBeTruthy();
  const idCounts = await page.evaluate(
    (ids) => ids.map((id) => document.querySelectorAll(`[id="${id}"]`).length),
    (labelledBy as string).split(' '),
  );
  expect(idCounts).toEqual([1, 1]);

  await switcher.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');

  await switcher.click();
  await page.locator('[role="option"][data-locale="de"]').click();
  await page.waitForURL(/\/de$/);
  await expect(switcher).toHaveAttribute('data-current-locale', 'de');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');

  await switcher.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(switcher).toHaveAttribute('data-current-locale', 'de');
});
