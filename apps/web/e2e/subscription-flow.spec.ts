import { test, expect, type Page } from '@playwright/test';

// End-to-end proof that the whole Subscriptions module actually works
// against a real deployment: log in -> search -> locked nutriments -> real
// Stripe test-mode Checkout -> webhook fires -> nutriments unlock. Run
// against any environment via BASE_URL (see playwright.config.ts); defaults
// to local dev. Requires STRIPE_SECRET_KEY in the environment so the
// afterAll hook can cancel the subscription it creates - this test must
// never leave the target environment's demo user in a subscribed state,
// the same discipline Module 3's own local verification followed.
//
// Checkout now requires a logged-in user (see the login/multi-user
// module's PR description) - this suite logs in as
// demo5@food-finder.local (apps/api/prisma/seed.ts) first, a seeded
// account not used by e2e/login.spec.ts or e2e/recent-searches.spec.ts, so
// this one real subscribe attempt never collides with those suites'
// assumptions about their own accounts' state.
//
// Not part of `npm test` / CI - this hits real Stripe test-mode Checkout
// and a real deployment, not something to run on every push. Invoke
// directly: `BASE_URL=... STRIPE_SECRET_KEY=... npm run test:e2e`.

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY must be set to run this suite (needed for cleanup).');
}

const DEMO_ACCOUNT = { email: 'demo5@food-finder.local', password: 'FoodFinderDemo!2026' };

let createdSubscriptionId: string | undefined;

async function login(page: Page) {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(DEMO_ACCOUNT.email);
  await page.getByLabel('Password').fill(DEMO_ACCOUNT.password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL(/\/en$/);
}

// `exact: true` matters here: once this account has any recent-search
// history, each entry's delete button carries an aria-label like `Remove
// "<query>" from recent searches` - "searches" alone substring-matches
// `{ name: 'Search' }` under Playwright's default non-exact matching,
// so an unscoped lookup resolves to more than one element.
async function search(page: Page, query: string) {
  await page.getByRole('searchbox', { name: 'Find a food product' }).fill(query);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Nutrition info is available to subscribers.').first()).toBeVisible({
    timeout: 15_000,
  });
}

test('search -> subscribe via real Stripe Checkout -> nutriments unlock', async ({ page }) => {
  await login(page);

  // Nutriments locked before subscribing (logged in, but not yet
  // subscribed).
  await search(page, 'nutella');
  await expect(page.getByRole('button', { name: 'Subscribe to unlock nutrition info' }).first()).toBeVisible();

  // Real Stripe test-mode Checkout, not a mock.
  await page.getByRole('button', { name: 'Subscribe to unlock nutrition info' }).first().click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 20_000 });

  // Verified empirically: Stripe's hosted Checkout page (unlike embedded
  // Elements on a third-party site) renders these as plain page elements,
  // not iframe-isolated - no frameLocator needed.
  //
  // The email field is conditional: Stripe's Link feature recognizes a
  // *reused* test email (this suite always uses the same one) and shows it
  // as pre-filled static text instead of an editable input - confirmed live
  // after a few repeated runs. Only fill it if it's actually there to fill.
  const emailField = page.getByPlaceholder('email@example.com');
  if (await emailField.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await emailField.fill('e2e-test@food-finder.local');
  }
  await page.getByPlaceholder('1234 1234 1234 1234').fill('4242424242424242');
  await page.getByPlaceholder('MM / YY').fill('12/34');
  await page.getByPlaceholder('CVC').fill('123');
  await page.getByPlaceholder('Full name on card').fill('E2E Test');

  await page.getByRole('button', { name: 'Subscribe' }).click();

  // Webhook needs a moment to fire and update the User row after redirect.
  await page.waitForURL((url) => url.pathname.includes('/subscribe/success'), { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: "You're subscribed!" })).toBeVisible();

  // Confirm gating actually flipped server-side - the whole point of this
  // test. A fresh search should now show real nutrition values instead of
  // the locked message, since the API re-checks User.subscriptionStatus on
  // every request rather than relying on any client-side state.
  await page.goto('/en');
  await page.waitForTimeout(3_000); // small buffer for the webhook to have landed
  await page.getByRole('searchbox', { name: 'Find a food product' }).fill('nutella');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  // Scoped to the first card specifically, not "nowhere on the page" - some
  // Open Food Facts products genuinely have no nutriment data at all
  // (same reason some have no image), so they show the same "subscribe to
  // unlock" message regardless of subscription status. That's a data gap,
  // not a gating bug - confirmed live: this exact assertion unscoped failed
  // even with a real, active subscription, while nutella (the query used
  // here) is confirmed to have real nutriment data in OFF.
  const firstCard = page.getByRole('article').first();
  await expect(firstCard.getByText('Energy (kcal)')).toBeVisible({ timeout: 15_000 });
  await expect(firstCard.getByText('Nutrition info is available to subscribers.')).not.toBeVisible();
});

test.afterAll(async () => {
  // Reset state: find every Stripe customer sharing this test email and
  // cancel any active subscription on each of them, so this suite never
  // leaves a shared/demo environment in a subscribed state.
  //
  // Every real run of this test creates a BRAND NEW Stripe customer (the
  // checkout is configured with customer_creation: always, so it never
  // reuses an existing one) - across repeated runs this leaves several
  // customer objects sharing the same test email. Checking only the first
  // search result (`data[0]`) is not safe: confirmed live that Stripe's
  // customer search does not return them newest-first, so a run's cleanup
  // could cancel a stale customer's (already-canceled) subscription while
  // leaving the run's own real one active. Iterate every match instead.
  const res = await fetch('https://api.stripe.com/v1/customers/search?query=' + encodeURIComponent('email:"e2e-test@food-finder.local"') + '&limit=100', {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const data = (await res.json()) as { data?: Array<{ id: string }> };

  for (const customer of data.data ?? []) {
    const subsRes = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${customer.id}&status=active`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    const subsData = (await subsRes.json()) as { data?: Array<{ id: string }> };
    for (const sub of subsData.data ?? []) {
      await fetch(`https://api.stripe.com/v1/subscriptions/${sub.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
      });
    }
  }
});
