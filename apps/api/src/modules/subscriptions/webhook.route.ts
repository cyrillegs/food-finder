// POST /api/webhooks/stripe
//
// Stripe signature verification needs the exact raw request bytes - Express
// 5's global `express.json()` (applied in shared/app.ts) would have already
// consumed and parsed the body by the time a normal route saw it, which
// silently breaks `stripe.webhooks.constructEvent`. The fix has two parts,
// both required:
//   1. `express.raw({ type: 'application/json' })` is applied ONLY on this
//      route (not globally) so `req.body` here is the untouched Buffer.
//   2. shared/app.ts mounts this router BEFORE `app.use(express.json())`,
//      so the global parser never runs against this path at all.
// This was verified against a real signed event during local development,
// not just compiled - see the module's PR description for how.
import { Router, raw, type Request, type Response } from 'express';
import type Stripe from 'stripe';
import { getStripeClient } from './stripe-client';
import { handleCheckoutSessionCompleted, handleSubscriptionDeleted, handleSubscriptionUpdated } from './subscriptions.service';

export const webhookRouter = Router();

webhookRouter.post('/stripe', raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('Received a Stripe webhook but STRIPE_WEBHOOK_SECRET is not configured.');
    res.status(500).json({ error: { message: 'Webhook is not configured.' } });
    return;
  }

  if (typeof signature !== 'string') {
    res.status(400).json({ error: { message: 'Missing Stripe-Signature header.' } });
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(req.body as Buffer, signature, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    res.status(400).json({ error: { message: 'Invalid Stripe webhook signature.' } });
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    default:
      // Other event types aren't relevant to this module's gating logic -
      // acknowledge them anyway so Stripe doesn't retry.
      break;
  }

  res.json({ received: true });
});
