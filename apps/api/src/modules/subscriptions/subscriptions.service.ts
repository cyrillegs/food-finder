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

// Thrown when a user who already has a live subscription tries to start
// another Checkout. The route maps this to a 409 rather than a 500 - it's a
// "you already have this" answer, not a failure.
export class AlreadySubscribedError extends Error {
  constructor() {
    super('This account already has an active subscription.');
    this.name = 'AlreadySubscribedError';
  }
}

// Stripe statuses that mean "this person already has a subscription, don't
// sell them another one". `incomplete`/`incomplete_expired` are deliberately
// excluded: those are checkouts whose first payment never succeeded, and
// blocking on them would strand a user whose card was declined and who is
// legitimately retrying. `canceled`/`unpaid` are terminal.
const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due']);

type LiveSubscription = { customerId: string; subscriptionId: string; status: string };

// Asks Stripe (not the local row) whether this user already has a live
// subscription. Checks the known customer first, then falls back to looking
// up customers by email - which is what catches the mid-race case, where a
// brand-new customer was minted during a Checkout whose webhook hasn't
// landed yet, so the local row has no stripeCustomerId to search by.
// `customers.list({email})` rather than `customers.search()` on purpose:
// search is eventually consistent (a customer created seconds ago may not
// be indexed yet), and this race is measured in seconds.
async function findLiveSubscription(stripe: Stripe, user: { email: string; stripeCustomerId: string | null }): Promise<LiveSubscription | null> {
  const customerIds: string[] = [];
  if (user.stripeCustomerId) {
    customerIds.push(user.stripeCustomerId);
  }

  const byEmail = await stripe.customers.list({ email: user.email, limit: 20 });
  for (const customer of byEmail.data) {
    if (!customerIds.includes(customer.id)) {
      customerIds.push(customer.id);
    }
  }

  for (const customerId of customerIds) {
    const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    const liveOne = subscriptions.data.find((s) => LIVE_SUBSCRIPTION_STATUSES.has(s.status));
    if (liveOne) {
      return { customerId, subscriptionId: liveOne.id, status: liveOne.status };
    }
  }

  return null;
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

  // Refuse to open a second Checkout for someone who is already paying.
  // The local status alone is not enough to decide this: between finishing
  // Checkout and the webhook landing, the row still says `inactive`, so the
  // UI still renders the Subscribe button and a second click here would
  // mint a SECOND Stripe customer and a SECOND concurrently-billed
  // subscription - with the first one then orphaned, since
  // syncSubscriptionStatus matches users by stripeCustomerId and the row
  // now points at the newer customer. So this asks Stripe directly, which
  // is authoritative even mid-race, and heals the local row from the answer.
  const live = await findLiveSubscription(stripe, user);
  if (live) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        stripeCustomerId: live.customerId,
        stripeSubscriptionId: live.subscriptionId,
        subscriptionStatus: live.status,
      },
    });
    throw new AlreadySubscribedError();
  }

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

export type ReconciliationResult = {
  userId: number;
  email: string;
  previousStatus: string;
  currentStatus: string;
  changed: boolean;
  // Set only when this user's Stripe call itself failed (rate limit,
  // network blip, bad id) - currentStatus/changed reflect "left untouched",
  // not "confirmed unchanged", when this is present.
  error?: string;
};

// Backstop for the acknowledged gap in this design: subscriptionStatus is a
// mirror of Stripe's state that only updates when a webhook successfully
// lands (handleCheckoutSessionCompleted / syncSubscriptionStatus above). If
// a webhook is ever lost (network blip, Stripe outage), that user's row
// drifts and stays stale indefinitely - nothing else in this module ever
// re-checks it. This asks Stripe directly, for every user who has ever been
// through Checkout, and heals any row that no longer matches. Meant to run
// on a schedule (see src/scripts/reconcile-subscriptions.ts), not per
// request - each user costs a real Stripe API call.
//
// Deliberately does NOT retrieve-by-id first: a canceled Subscription
// object is never actually deleted on Stripe's side and stays retrievable
// by id indefinitely (confirmed against Stripe's own API docs - DELETE
// /v1/subscriptions/:id itself just returns the object with
// status:'canceled'), so a stale stripeSubscriptionId pointing at an old,
// genuinely-canceled subscription would keep "succeeding" forever and mask
// a newer subscription the user created after resubscribing - exactly the
// missed-webhook case this job exists to catch. Always lists the
// customer's subscriptions instead (same cost as one retrieve-by-id call)
// and prefers a live one, the same way findLiveSubscription above does,
// rather than trusting Stripe's list ordering to put the relevant one
// first.
//
// Known, accepted gap: only reconciles users who already have a
// stripeCustomerId on file, which itself is only ever set once
// checkout.session.completed lands. A user whose very first webhook is the
// one that got lost has no local trace to reconcile from at all - closing
// that would mean periodically searching Stripe by email for every user,
// a materially bigger operation than this backstop, and out of scope here.
export async function reconcileAllSubscriptions(): Promise<ReconciliationResult[]> {
  const stripe = getStripeClient();
  const users = await prisma.user.findMany({
    where: { stripeCustomerId: { not: null } },
    select: { id: true, email: true, stripeCustomerId: true, stripeSubscriptionId: true, subscriptionStatus: true },
  });

  const results: ReconciliationResult[] = [];

  for (const user of users) {
    try {
      const list = await stripe.subscriptions.list({ customer: user.stripeCustomerId!, status: 'all', limit: 100 });
      // Prefer a live one if the customer has more than one subscription
      // record (e.g. an abandoned duplicate checkout alongside the real
      // one) - falls back to whatever Stripe returns first only when none
      // of them are live.
      const resolved = list.data.find((s) => LIVE_SUBSCRIPTION_STATUSES.has(s.status)) ?? list.data[0] ?? null;

      // No subscription found at all (fully absent from the list, not just
      // canceled) reads as 'canceled' locally too - there is nothing left
      // to unlock nutriments with.
      const currentStatus = resolved?.status ?? 'canceled';
      // Id drift matters even when the status string happens to match (a
      // canceled-then-resubscribed customer can land on the same status by
      // coincidence) - comparing both is what actually "heals" the row
      // rather than silently leaving a stale id in place.
      const changed = currentStatus !== user.subscriptionStatus || resolved?.id !== user.stripeSubscriptionId;

      if (changed) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            subscriptionStatus: currentStatus,
            stripeSubscriptionId: resolved?.id ?? null,
          },
        });
      }

      results.push({
        userId: user.id,
        email: user.email,
        previousStatus: user.subscriptionStatus,
        currentStatus,
        changed,
      });
    } catch (err) {
      // One user's Stripe failure (rate limit, network blip, a rejected
      // customer id) must not abort the whole run - record it and move on,
      // so a scheduled run still heals everyone it safely can instead of
      // silently discarding every result gathered so far.
      results.push({
        userId: user.id,
        email: user.email,
        previousStatus: user.subscriptionStatus,
        currentStatus: user.subscriptionStatus,
        changed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
