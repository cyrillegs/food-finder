// POST /api/subscriptions/checkout-session
//
// Creates a Stripe Checkout Session for the one DemoUser and returns its
// hosted URL. The frontend redirects the browser there directly
// (window.location.href) - no Stripe.js/publishable key needed for this
// module's plan (SubscribeButton.tsx).
//
// There's deliberately no GET status route here: the frontend has no
// separate "am I subscribed?" flag to poll. Gating is enforced entirely
// through the Search response (see subscriptions.gate.ts) - a search made
// after returning from Checkout naturally reflects the new
// DemoUser.subscriptionStatus because the gate re-checks it on every
// request. Adding a status endpoint here would just be a second way to ask
// a question the Search response already answers.
import { Router, type Request, type Response } from 'express';
import { createCheckoutSession } from './subscriptions.service';
import { SUPPORTED_LOCALES, type SupportedLocale } from '../search/search.types';

export const subscriptionsRouter = Router();

function resolveLocale(value: unknown): SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
    ? (value as SupportedLocale)
    : 'en';
}

// CORS_ORIGIN already represents "the web app's origin" in both local and
// deployed config (see shared/app.ts) - reused here rather than introducing
// a second env var just for building redirect URLs.
function resolveWebOrigin(): string {
  return process.env.CORS_ORIGIN ?? 'http://localhost:3000';
}

subscriptionsRouter.post('/checkout-session', async (req: Request, res: Response) => {
  const locale = resolveLocale((req.body as { locale?: unknown } | undefined)?.locale);
  const url = await createCheckoutSession(resolveWebOrigin(), locale);
  res.json({ url });
});
