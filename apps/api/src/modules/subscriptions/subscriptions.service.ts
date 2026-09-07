// Stripe integration for the one DemoUser this app ever acts as (see
// prisma/schema.prisma - DemoUser id 1, seeded in Module 0). No auth, no
// multi-tenancy: every function here reads/writes that single row.
//
// The Stripe customer is deliberately NOT created eagerly in
// createCheckoutSession - if DemoUser.stripeCustomerId is unset, `customer`
// is simply omitted from the Checkout Session params and Stripe creates one
// for us. We only learn (and persist) that customer id once the webhook
// fires, so there's one source of truth for "a real subscription attempt
// happened": the webhook, not the button click.
import { prisma } from '../../shared/prisma';
import { getStripeClient } from './stripe-client';
import type Stripe from 'stripe';

// Matches the single seeded row from apps/api/prisma/seed.ts.
const DEMO_USER_ID = 1;

function resolveStripeId(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return typeof value === 'string' ? value : value.id;
}

// Creates a subscription-mode Checkout Session for the demo user and returns
// its hosted URL. `webOrigin` and `locale` are supplied by the route (not
// read from env here) so this stays testable without stubbing request
// context; the route resolves webOrigin from CORS_ORIGIN, which already
// represents "the web app's origin" in both local and deployed config.
export async function createCheckoutSession(webOrigin: string, locale: string): Promise<string> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error('STRIPE_PRICE_ID is not configured.');
  }

  const demoUser = await prisma.demoUser.findUniqueOrThrow({ where: { id: DEMO_USER_ID } });
  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    // Reuse the existing Stripe customer if we've already learned one via a
    // prior webhook; otherwise leave this unset and let Stripe create one.
    customer: demoUser.stripeCustomerId ?? undefined,
    success_url: `${webOrigin}/${locale}/subscribe/success`,
    cancel_url: `${webOrigin}/${locale}/subscribe/cancel`,
  });

  if (!session.url) {
    throw new Error('Stripe did not return a Checkout Session URL.');
  }

  return session.url;
}

// Gating predicate used by the Search module wrapper (subscriptions.gate.ts)
// to decide whether to include nutriments in a Search response.
export async function isNutrimentsUnlocked(): Promise<boolean> {
  const demoUser = await prisma.demoUser.findUnique({ where: { id: DEMO_USER_ID } });
  return demoUser?.subscriptionStatus === 'active';
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
  if (!customerId || !subscriptionId) {
    return;
  }

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  await prisma.demoUser.update({
    where: { id: DEMO_USER_ID },
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
// `canceled` status that .deleted events carry.
async function syncSubscriptionStatus(subscription: Stripe.Subscription): Promise<void> {
  const customerId = resolveStripeId(subscription.customer);
  if (!customerId) {
    return;
  }

  // Guard against a stray event for some other Stripe customer (e.g. one
  // sent from the Dashboard's "send test webhook" while testing) landing
  // here and overwriting the one DemoUser row based on an unrelated
  // subscription.
  const demoUser = await prisma.demoUser.findUnique({ where: { id: DEMO_USER_ID } });
  if (!demoUser || demoUser.stripeCustomerId !== customerId) {
    return;
  }

  await prisma.demoUser.update({
    where: { id: DEMO_USER_ID },
    data: {
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
    },
  });
}
