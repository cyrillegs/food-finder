import { test, expect, type Page } from '@playwright/test';

// End-to-end proof that the whole Subscriptions module actually works
// against a real deployment: search -> locked nutriments -> real Stripe
// test-mode Checkout -> webhook fires -> nutriments unlock. Run against
// any environment via BASE_URL (see playwright.config.ts); defaults to
// local dev. Requires STRIPE_SECRET_KEY in the environment so the
// afterAll hook can cancel the subscription it creates - this test must
// never leave the target environment's demo user in a subscribed state,
// the same discipline Module 3's own local verification followed.
//
// Not part of `npm test` / CI - this hits real Stripe test-mode Checkout
// and a real deployment, not something to run on every push. Invoke
// directly: `BASE_URL=... STRIPE_SECRET_KEY=... npm run test:e2e`.

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY must be set to run this suite (needed for cleanup).');
}

let createdSubscriptionId: string | undefined;

async function search(page: Page, query: string) {
  await page.getByRole('searchbox', { name: 'Find a food product' }).fill(query);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('Nutrition info is available to subscribers.').first()).toBeVisible({
    timeout: 15_000,
  });
}

test('search -> subscribe via real Stripe Checkout -> nutriments unlock', async ({ page }) => {
  await page.goto('/en');

  // Nutriments locked before subscribing.
  await search(page, 'nutella');
  await expect(page.getByRole('button', { name: 'Subscribe to unlock nutrition info' }).first()).toBeVisible();

  // Real Stripe test-mode Checkout, not a mock.
  await page.getByRole('button', { name: 'Subscribe to unlock nutrition info' }).first().click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 20_000 });

  // Verified empirically: Stripe's hosted Checkout page (unlike embedded
  // Elements on a third-party site) renders these as plain page elements,
  // not iframe-isolated - no frameLocator needed.
  await page.getByPlaceholder('email@example.com').fill('e2e-test@food-finder.local');
  await page.getByPlaceholder('1234 1234 1234 1234').fill('4242424242424242');
  await page.getByPlaceholder('MM / YY').fill('12/34');
  await page.getByPlaceholder('CVC').fill('123');
  await page.getByPlaceholder('Full name on card').fill('E2E Test');

  await page.getByRole('button', { name: 'Subscribe' }).click();

  // Webhook needs a moment to fire and update DemoUser after redirect.
  await page.waitForURL((url) => url.pathname.includes('/subscribe/success'), { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: "You're subscribed!" })).toBeVisible();

  // Confirm gating actually flipped server-side - the whole point of this
  // test. A fresh search should now show real nutrition values instead of
  // the locked message, since the API re-checks DemoUser.subscriptionStatus
  // on every request rather than relying on any client-side state.
  await page.goto('/en');
  await page.waitForTimeout(3_000); // small buffer for the webhook to have landed
  await page.getByRole('searchbox', { name: 'Find a food product' }).fill('nutella');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('Energy (kcal)').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Nutrition info is available to subscribers.').first()).not.toBeVisible();
});

test.afterAll(async () => {
  // Reset state: find the demo customer's active test subscription and cancel
  // it, so this suite never leaves a shared/demo environment in a subscribed
  // state. Looked up by email rather than a captured ID, since the test above
  // doesn't currently plumb the subscription ID back out of the page.
  const res = await fetch('https://api.stripe.com/v1/customers/search?query=' + encodeURIComponent('email:"e2e-test@food-finder.local"'), {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  const customerId = data.data?.[0]?.id;
  if (!customerId) return;

  const subsRes = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=active`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const subsData = (await subsRes.json()) as { data?: Array<{ id: string }> };
  for (const sub of subsData.data ?? []) {
    await fetch(`https://api.stripe.com/v1/subscriptions/${sub.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
  }
});
