// Stripe integration, now scoped per authenticated User instead of the one
// hardcoded DemoUser row (see prisma/schema.prisma). Every function here
// takes the acting user's id explicitly rather than assuming a fixed one -
// callers (subscriptions.route.ts, webhook.route.ts) are responsible for
// resolving that id (via the auth middleware, or via Stripe identifiers for
// the webhook).
//
// The Stripe customer is still deliberately NOT created eagerly in
// createCheckoutSession - if the user's stripeCustomerId is unset,
// `customer` is simply omitted from the Checkout Session params and Stripe
// creates one for us. We only learn (and persist) that customer id once the
// webhook fires, so there's one source of truth for "a real subscription
// attempt happened": the webhook, not the button click.
import { prisma } from '../../shared/prisma';
import { getStripeClient } from './stripe-client';
import type Stripe from 'stripe';

function resolveStripeId(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return typeof value === 'string' ? value : value.id;
}

// Creates a subscription-mode Checkout Session for the given user and
// returns its hosted URL. `webOrigin` and `locale` are supplied by the
// route (not read from env here) so this stays testable without stubbing
// request context; the route resolves webOrigin from CORS_ORIGIN, which
// already represents "the web app's origin" in both local and deployed
// config.
export async function createCheckoutSession(webOrigin: string, locale: string, userId: number): Promise<string> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error('STRIPE_PRICE_ID is not configured.');
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    // Reuse the existing Stripe customer if we've already learned one via a
    // prior webhook; otherwise leave this unset and let Stripe create one.
    customer: user.stripeCustomerId ?? undefined,
    // `customer` and `customer_email` are mutually exclusive - Stripe
    // rejects a Checkout Session that sets both (confirmed against Stripe's
    // own current API docs). A returning subscriber's existing customer
    // record already carries their email (Stripe pre-fills it from there
    // automatically); a first-time subscriber has no customer yet, so this
    // is the only way to get their real email onto the Checkout page and
    // the brand-new Customer Stripe creates for them, instead of leaving
    // both blank and making them retype an email they already gave us at
    // login.
    customer_email: user.stripeCustomerId ? undefined : user.email,
    // Attributes this Checkout Session back to the initiating User, so
    // handleCheckoutSessionCompleted below can persist the resulting
    // customer/subscription ids onto the right row. This matters
    // specifically for a first-time subscriber: `customer` above is unset
    // for them, so Stripe mints a brand-new customer id during Checkout
    // that the webhook has never seen before and has no other way to match
    // back to a User (a returning subscriber's existing stripeCustomerId
    // would have worked for that, but a new one obviously can't).
    client_reference_id: String(user.id),
    success_url: `${webOrigin}/${locale}/subscribe/success`,
    cancel_url: `${webOrigin}/${locale}/subscribe/cancel`,
  });

  if (!session.url) {
    throw new Error('Stripe did not return a Checkout Session URL.');
  }

  return session.url;
}

// checkout.session.completed is where we first learn the Stripe customer id
// and subscription id together (for a brand-new subscriber, Stripe may have
// just created that customer for us - see createCheckoutSession above). We
// look the subscription back up rather than assuming a status: Checkout
// Sessions in subscription mode postpone subscription creation until
// payment succeeds, but the resulting subscription's actual status (e.g.
// `trialing` if the Price has a trial, `active` otherwise) is only known by
// asking Stripe for it directly - guessing here would drift from Stripe's
// own vocabulary in exactly the way the plan says not to.
export async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== 'subscription') {
    return;
  }

  const customerId = resolveStripeId(session.customer);
  const subscriptionId = resolveStripeId(session.subscription);
  const userId = session.client_reference_id ? Number(session.client_reference_id) : NaN;
  if (!customerId || !subscriptionId || !Number.isInteger(userId)) {
    return;
  }

  // Guard against a tampered/stale client_reference_id (or a test event
  // referencing a user that no longer exists) rather than letting a plain
  // `update` throw on a missing row - a webhook handler failing loudly here
  // would make Stripe retry the same undeliverable event indefinitely.
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return;
  }

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  await prisma.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: subscription.status,
    },
  });
}

export async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  await syncSubscriptionStatus(subscription);
}

export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  await syncSubscriptionStatus(subscription);
}

// Shared by both customer.subscription.updated and .deleted - both just mean
// "here is this subscription's current status", including the terminal
// `canceled` status that .deleted events carry. Unlike
// handleCheckoutSessionCompleted, these events carry no client_reference_id
// (they're Subscription objects, not Checkout Sessions) - by the time either
// of these fires, the owning User's stripeCustomerId has already been set by
// a prior checkout.session.completed, so matching on that is the only
// signal available, and the right one: it's how we find "the right User" now
// that there isn't a single hardcoded one.
async function syncSubscriptionStatus(subscription: Stripe.Subscription): Promise<void> {
  const customerId = resolveStripeId(subscription.customer);
  if (!customerId) {
    return;
  }

  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
  if (!user) {
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
    },
  });
}
