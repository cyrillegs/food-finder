// Mocks Prisma (equivalent, for this module, to how search.test.ts mocks
// `fetch`: neither suite should touch real infrastructure) and mocks
// stripe-client.ts's getStripeClient() to stub out the two calls that would
// otherwise hit the real Stripe API (checkout.sessions.create,
// subscriptions.retrieve).
//
// The webhook tests deliberately do NOT stub `stripe.webhooks` - they use a
// real Stripe SDK instance (constructed with a throwaway fake key; webhook
// signing/verification is pure local HMAC and never touches the network or
// validates the key against Stripe) so `generateTestHeaderString` and the
// webhook route's own `constructEvent` call exercise real signature
// verification end to end, per the plan's instruction not to bypass it.
//
// Checkout is now behind requireAuth (see subscriptions.route.ts), and the
// nutriments gate resolves "who's asking" via a session cookie rather than
// a hardcoded id - both go through the Auth module's session lookup, so
// `prisma.session` is mocked here too, alongside `prisma.user` (renamed
// from `prisma.demoUser`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../shared/app';
import { applyNutrimentsGate } from './subscriptions.gate';
import type { SearchResponseBody } from '../search/search.types';
import type Stripe from 'stripe';

// vi.hoisted lifts these mock doubles above the `vi.mock` calls below (which
// are themselves hoisted above the imports above by Vitest) - required
// because the mock factories close over them, and referencing a plain
// module-level `const` from inside a hoisted factory hits the temporal-dead-
// zone trap Vitest's own docs warn about for `vi.mock`.
//
// `realWebhooks` is the Stripe SDK's genuine `.webhooks` helper - verified
// (2026-09, SDK v22.x) to be a *static* property on the Stripe class itself
// (`Stripe.webhooks === new Stripe(key).webhooks`), so no client instance or
// API key is even needed to reach it. Loaded via a synchronous `require`
// (this project's apps/api package has no "type": "module", so CJS require
// works here) so it's ready before the mocked `./stripe-client` module is
// ever resolved. Webhook signing/verification is pure local HMAC - it never
// touches the network - so `generateTestHeaderString` and the webhook
// route's own `constructEvent` call below exercise real signature
// verification end to end, per the plan's instruction not to bypass it.
const { userMock, sessionMock, stripeMocks, realWebhooks } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const StripeCtor = require('stripe') as typeof Stripe;
  return {
    userMock: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    sessionMock: {
      findUnique: vi.fn(),
    },
    stripeMocks: {
      checkoutSessionsCreate: vi.fn(),
      subscriptionsRetrieve: vi.fn(),
    },
    realWebhooks: StripeCtor.webhooks,
  };
});

vi.mock('../../shared/prisma', () => ({
  prisma: { user: userMock, session: sessionMock },
}));

vi.mock('./stripe-client', () => ({
  getStripeClient: () => ({
    checkout: { sessions: { create: stripeMocks.checkoutSessionsCreate } },
    subscriptions: { retrieve: stripeMocks.subscriptionsRetrieve },
    webhooks: realWebhooks,
  }),
}));

const WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests';
const SESSION_COOKIE = 'ff_session=test-session-token';

// The exact token text is irrelevant - prisma.session.findUnique is mocked
// directly rather than re-deriving a real hash, only that a cookie is
// present or absent at all matters for the auth middleware's branching.
function mockLoggedInAs(userId: number, overrides: Record<string, unknown> = {}) {
  sessionMock.findUnique.mockResolvedValue({
    id: 1,
    tokenHash: 'irrelevant-in-tests',
    userId,
    expiresAt: new Date(Date.now() + 60_000),
  });
  userMock.findUnique.mockResolvedValue({
    id: userId,
    email: `user${userId}@food-finder.local`,
    subscriptionStatus: 'inactive',
    stripeCustomerId: null,
    ...overrides,
  });
}

function signedWebhookRequest(eventPayload: unknown) {
  const payload = JSON.stringify(eventPayload);
  const signature = realWebhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });

  return request(app)
    .post('/api/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', signature)
    .send(payload);
}

function fakeCheckoutSessionCompletedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_test_1',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        object: 'checkout.session',
        mode: 'subscription',
        customer: 'cus_test_1',
        subscription: 'sub_test_1',
        payment_status: 'paid',
        client_reference_id: '1',
        ...overrides,
      },
    },
  };
}

function fakeSubscriptionEvent(type: 'customer.subscription.updated' | 'customer.subscription.deleted', overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_test_2',
    object: 'event',
    type,
    data: {
      object: {
        id: 'sub_test_1',
        object: 'subscription',
        customer: 'cus_test_1',
        status: 'past_due',
        ...overrides,
      },
    },
  };
}

describe('Subscriptions module', () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_ID = 'price_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.CORS_ORIGIN = 'http://localhost:3000';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/subscriptions/checkout-session', () => {
    it('requires a logged-in user - 401 with no session cookie', async () => {
      const res = await request(app).post('/api/subscriptions/checkout-session').send({ locale: 'en' });

      expect(res.status).toBe(401);
      expect(stripeMocks.checkoutSessionsCreate).not.toHaveBeenCalled();
    });

    it('creates a subscription-mode Checkout Session for the logged-in user and returns its URL', async () => {
      mockLoggedInAs(1);
      userMock.findUniqueOrThrow.mockResolvedValue({ id: 1, email: 'demo1@food-finder.local', stripeCustomerId: null });
      stripeMocks.checkoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/test-session' });

      const res = await request(app)
        .post('/api/subscriptions/checkout-session')
        .set('Cookie', SESSION_COOKIE)
        .send({ locale: 'fr' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ url: 'https://checkout.stripe.com/test-session' });
      expect(stripeMocks.checkoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          line_items: [{ price: 'price_test_123', quantity: 1 }],
          customer: undefined,
          // No existing Stripe customer yet - Checkout should get the
          // user's real email so it's pre-filled on the hosted page instead
          // of asking them to retype an email they already gave us at
          // login.
          customer_email: 'demo1@food-finder.local',
          client_reference_id: '1',
          success_url: 'http://localhost:3000/fr/subscribe/success',
          cancel_url: 'http://localhost:3000/fr/subscribe/cancel',
        }),
      );
    });

    it('reuses an existing Stripe customer id instead of letting Stripe create a new one, and omits customer_email', async () => {
      mockLoggedInAs(1);
      userMock.findUniqueOrThrow.mockResolvedValue({ id: 1, email: 'demo1@food-finder.local', stripeCustomerId: 'cus_existing' });
      stripeMocks.checkoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/test-session-2' });

      await request(app).post('/api/subscriptions/checkout-session').set('Cookie', SESSION_COOKIE).send({});

      expect(stripeMocks.checkoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_existing', client_reference_id: '1' }),
      );
      // customer and customer_email are mutually exclusive per Stripe's API -
      // an existing customer already carries the email, so this must be
      // undefined (Stripe's SDK omits undefined params from the actual
      // request), not a real value alongside `customer`.
      const callArgs = stripeMocks.checkoutSessionsCreate.mock.calls[0][0];
      expect(callArgs.customer_email).toBeUndefined();
    });

    it('falls back to English when no/invalid locale is provided', async () => {
      mockLoggedInAs(1);
      userMock.findUniqueOrThrow.mockResolvedValue({ id: 1, stripeCustomerId: null });
      stripeMocks.checkoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/test-session-3' });

      await request(app)
        .post('/api/subscriptions/checkout-session')
        .set('Cookie', SESSION_COOKIE)
        .send({ locale: 'not-a-real-locale' });

      expect(stripeMocks.checkoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ success_url: 'http://localhost:3000/en/subscribe/success' }),
      );
    });

    it("scopes checkout to whichever user's session is presented, not a fixed id", async () => {
      mockLoggedInAs(2);
      userMock.findUniqueOrThrow.mockResolvedValue({ id: 2, stripeCustomerId: null });
      stripeMocks.checkoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/test-session-4' });

      await request(app).post('/api/subscriptions/checkout-session').set('Cookie', SESSION_COOKIE).send({});

      expect(userMock.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 2 } });
      expect(stripeMocks.checkoutSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({ client_reference_id: '2' }));
    });
  });

  describe('POST /api/webhooks/stripe', () => {
    it('rejects a request with an invalid signature without touching Prisma', async () => {
      const payload = JSON.stringify(fakeCheckoutSessionCompletedEvent());

      const res = await request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 't=1,v1=not-a-real-signature')
        .send(payload);

      expect(res.status).toBe(400);
      expect(userMock.update).not.toHaveBeenCalled();
    });

    it('syncs stripeCustomerId/stripeSubscriptionId/subscriptionStatus onto the User named by client_reference_id on checkout.session.completed', async () => {
      userMock.findUnique.mockResolvedValue({ id: 1 });
      stripeMocks.subscriptionsRetrieve.mockResolvedValue({ id: 'sub_test_1', status: 'active' });

      const res = await signedWebhookRequest(fakeCheckoutSessionCompletedEvent({ client_reference_id: '1' }));

      expect(res.status).toBe(200);
      expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_test_1');
      expect(userMock.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          stripeCustomerId: 'cus_test_1',
          stripeSubscriptionId: 'sub_test_1',
          subscriptionStatus: 'active',
        },
      });
    });

    it('ignores checkout.session.completed events outside subscription mode', async () => {
      const res = await signedWebhookRequest(fakeCheckoutSessionCompletedEvent({ mode: 'payment' }));

      expect(res.status).toBe(200);
      expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
      expect(userMock.update).not.toHaveBeenCalled();
    });

    it('ignores checkout.session.completed with no/invalid client_reference_id rather than guessing a user', async () => {
      const res = await signedWebhookRequest(fakeCheckoutSessionCompletedEvent({ client_reference_id: null }));

      expect(res.status).toBe(200);
      expect(userMock.update).not.toHaveBeenCalled();
    });

    it('ignores checkout.session.completed when client_reference_id names a user that no longer exists', async () => {
      userMock.findUnique.mockResolvedValue(null);

      const res = await signedWebhookRequest(fakeCheckoutSessionCompletedEvent({ client_reference_id: '999' }));

      expect(res.status).toBe(200);
      expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
      expect(userMock.update).not.toHaveBeenCalled();
    });

    it('syncs subscriptionStatus on customer.subscription.updated for the User matching the Stripe customer id', async () => {
      userMock.findFirst.mockResolvedValue({ id: 1, stripeCustomerId: 'cus_test_1', subscriptionStatus: 'active' });

      const res = await signedWebhookRequest(fakeSubscriptionEvent('customer.subscription.updated', { status: 'past_due' }));

      expect(res.status).toBe(200);
      expect(userMock.findFirst).toHaveBeenCalledWith({ where: { stripeCustomerId: 'cus_test_1' } });
      expect(userMock.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { stripeSubscriptionId: 'sub_test_1', subscriptionStatus: 'past_due' },
      });
    });

    it('syncs subscriptionStatus to canceled on customer.subscription.deleted', async () => {
      userMock.findFirst.mockResolvedValue({ id: 1, stripeCustomerId: 'cus_test_1', subscriptionStatus: 'active' });

      const res = await signedWebhookRequest(fakeSubscriptionEvent('customer.subscription.deleted', { status: 'canceled' }));

      expect(res.status).toBe(200);
      expect(userMock.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { stripeSubscriptionId: 'sub_test_1', subscriptionStatus: 'canceled' },
      });
    });

    it('ignores a subscription event for a customer that does not match any User', async () => {
      userMock.findFirst.mockResolvedValue(null);

      const res = await signedWebhookRequest(fakeSubscriptionEvent('customer.subscription.updated'));

      expect(res.status).toBe(200);
      expect(userMock.update).not.toHaveBeenCalled();
    });
  });

  // Gating "on" case (subscription active -> nutriments included in the
  // Search route's response). The "off"/default case (both anonymous and
  // logged-in-but-not-subscribed) is covered in search.test.ts, alongside
  // the rest of that module's own suite - not duplicated here.
  describe('Search response gating (active subscription)', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      mockLoggedInAs(1, { subscriptionStatus: 'active' });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('includes nutriments in /api/search results when the logged-in user is subscribed', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          hits: [
            {
              code: '3017620422003',
              product_name: 'Nutella',
              nutriments: { 'energy-kcal_100g': 539 },
            },
          ],
          count: 1,
          page: 1,
          page_size: 24,
          page_count: 1,
        }),
      });

      const res = await request(app).get('/api/search').query({ q: 'nutella', locale: 'en' }).set('Cookie', SESSION_COOKIE);

      expect(res.status).toBe(200);
      expect(res.body.results[0].nutriments).toEqual({ 'energy-kcal_100g': 539 });
      expect(res.body.subscriptionActive).toBe(true);
    });
  });

  describe('applyNutrimentsGate (pure function)', () => {
    const body: SearchResponseBody = {
      query: 'q',
      locale: 'en',
      page: 1,
      pageSize: 24,
      totalCount: 1,
      totalPages: 1,
      results: [{ code: '123', name: 'Thing', brand: null, imageUrl: null, nutriments: { fat_100g: 1 } }],
    };

    it('strips nutriments entirely when locked, and reports subscriptionActive: false', () => {
      const gated = applyNutrimentsGate(body, false);
      expect(gated.results[0]).not.toHaveProperty('nutriments');
      expect(gated.subscriptionActive).toBe(false);
    });

    it('leaves results untouched when unlocked, and reports subscriptionActive: true', () => {
      const gated = applyNutrimentsGate(body, true);
      expect(gated.results).toBe(body.results);
      expect(gated.subscriptionActive).toBe(true);
    });

    // The bug this flag exists to fix: a subscribed user searching for a
    // product Open Food Facts genuinely has no nutrition data for (not
    // uncommon - the same reason some products have no image) must be able
    // to tell "nothing to unlock" apart from "you're not subscribed" using
    // subscriptionActive, since a missing `nutriments` key looks identical
    // in both cases otherwise.
    it('reports subscriptionActive: true even for a product with no nutriments to begin with', () => {
      const bodyWithGap: SearchResponseBody = {
        ...body,
        results: [{ code: '456', name: 'No-data thing', brand: null, imageUrl: null }],
      };
      const gated = applyNutrimentsGate(bodyWithGap, true);
      expect(gated.results[0]).not.toHaveProperty('nutriments');
      expect(gated.subscriptionActive).toBe(true);
    });
  });
});
