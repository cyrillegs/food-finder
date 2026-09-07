import { test, expect } from '@playwright/test';

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
    await expect(switcher).toHaveValue(code);
    const optionValues = await switcher
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value).sort());
    expect(optionValues).toEqual(['de', 'en', 'fr', 'nl']);

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

  await page.getByTestId('language-switcher').selectOption('fr');
  await page.waitForURL(/\/fr\/subscribe\/success$/);
  await expect(page.getByRole('heading', { name: 'Vous êtes abonné !' })).toBeVisible();

  // And the reverse direction, from a locale other than the default back to
  // English, also lands on the equivalent page rather than bouncing home.
  await page.getByTestId('language-switcher').selectOption('en');
  await page.waitForURL(/\/en\/subscribe\/success$/);
  await expect(page.getByRole('heading', { name: "You're subscribed!" })).toBeVisible();
});

test('cycles through all four locales from the home page without getting stuck', async ({ page }) => {
  await page.goto('/en');

  for (const target of ['nl', 'de', 'fr', 'en'] as const) {
    await page.getByTestId('language-switcher').selectOption(target);
    await page.waitForURL(new RegExp(`/${target}$`));
    await expect(page.getByTestId('language-switcher')).toHaveValue(target);
  }
});
