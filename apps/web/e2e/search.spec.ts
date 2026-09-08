import { test, expect } from '@playwright/test';

// Regression coverage for SearchExperience.tsx's request-sequencing guard.
// Entirely mocked (no OFF/DB/auth dependency), so this runs anywhere the
// dev server does, unlike this project's other e2e suites.
//
// Proves the fix directly: fires a SLOW response for the first query and a
// FAST response for the second, so the slow one resolves LAST in real time
// - exactly the out-of-order case the fix exists for. Without the sequence
// guard, "chocolate"'s slow response would land after "milk"'s fast one and
// silently overwrite it.
test('a slower earlier search does not overwrite a faster later one', async ({ page }) => {
  await page.route('**/api/search*', async (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('q');
    const delay = q === 'chocolate' ? 1500 : 50;
    await new Promise((r) => setTimeout(r, delay));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: q,
        locale: 'en',
        page: 1,
        pageSize: 24,
        totalCount: 1,
        totalPages: 1,
        subscriptionActive: false,
        results: [{ code: q, name: `Result for ${q}`, brand: 'Test', imageUrl: null }],
      }),
    });
  });

  await page.goto('/en');
  const searchbox = page.getByRole('searchbox', { name: 'Find a food product' });
  const submit = page.getByRole('button', { name: 'Search', exact: true });

  await searchbox.fill('chocolate');
  await submit.click();
  // Don't wait for chocolate's slow response - fire milk's fast one while
  // chocolate is still in flight, matching a user typing a second query
  // quickly after the first.
  await page.waitForTimeout(100);
  await searchbox.fill('milk');
  await submit.click();

  // Milk's fast response should win and stay won even after chocolate's
  // slow one finally arrives.
  await expect(page.getByText('Result for milk')).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(2000); // let chocolate's late response land
  await expect(page.getByText('Result for milk')).toBeVisible();
  await expect(page.getByText('Result for chocolate')).toHaveCount(0);
});
