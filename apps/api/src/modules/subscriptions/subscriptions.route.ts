// POST /api/subscriptions/checkout-session
//
// Creates a Stripe Checkout Session for the currently authenticated user and
// returns its hosted URL. The frontend redirects the browser there directly
// (window.location.href) - no Stripe.js/publishable key needed for this
// module's plan (SubscribeButton.tsx).
//
// Requires a logged-in user (requireAuth below) - there's no anonymous
// checkout, since there'd be no User row to attach the resulting
// subscription to. apps/web shows a "log in to subscribe" prompt instead of
// this button's normal behavior when logged out; see SubscribeButton.tsx.
//
// There's deliberately no GET status route here: the frontend has no
// separate "am I subscribed?" flag to poll. Gating is enforced entirely
// through the Search response (see subscriptions.gate.ts) - a search made
// after returning from Checkout naturally reflects the new
// User.subscriptionStatus because the gate re-checks it on every request.
// Adding a status endpoint here would just be a second way to ask a
// question the Search response already answers.
import { Router, type Request, type Response } from 'express';
import { AlreadySubscribedError, createCheckoutSession } from './subscriptions.service';
import { SUPPORTED_LOCALES, type SupportedLocale } from '../search/search.types';
import { requireAuth } from '../auth/auth.middleware';

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

subscriptionsRouter.post('/checkout-session', requireAuth, async (req: Request, res: Response) => {
  const locale = resolveLocale((req.body as { locale?: unknown } | undefined)?.locale);
  // requireAuth has already 401'd and returned if there's no logged-in user,
  // so req.user is guaranteed to be set by the time this handler runs.
  try {
    const url = await createCheckoutSession(resolveWebOrigin(), locale, req.user!.id);
    res.json({ url });
  } catch (err) {
    // 409, not 500: the user asked for something that no longer makes sense
    // rather than hitting a failure. createCheckoutSession has already
    // healed their row from Stripe's answer by this point, so the frontend
    // just needs to re-read state (see SubscribeButton.tsx).
    if (err instanceof AlreadySubscribedError) {
      res.status(409).json({ error: { message: err.message, code: 'already_subscribed' } });
      return;
    }
    throw err;
  }
});
