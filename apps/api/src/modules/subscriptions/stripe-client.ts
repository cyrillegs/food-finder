// Thin factory around the Stripe SDK client. Kept as its own module (rather
// than folded into subscriptions.service.ts) purely as a test seam: the test
// suite mocks this one function to stub out network-touching calls
// (checkout.sessions.create, subscriptions.retrieve) while still exercising
// the SDK's real, network-free webhook signature helpers
// (stripe.webhooks.constructEvent / generateTestHeaderString) - see
// subscriptions.test.ts.
//
// Verified against the Stripe Node SDK's current README (2026-09, SDK
// v19.1.0 docs / npm latest 22.x): apiVersion is optional on the
// constructor - omitting it pins requests to the API version configured on
// the Stripe account/API key, which is the right default here since this
// project doesn't need a specific pinned version.
import Stripe from 'stripe';

// Deliberately not memoized into a module-level singleton: constructing a
// Stripe client does no network I/O, so there's no cost to creating one per
// call, and it keeps this function trivially mockable per-test without
// worrying about a cached instance leaking between tests.
export function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured.');
  }
  return new Stripe(secretKey);
}
