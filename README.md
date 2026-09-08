# Food Finder

A full-stack app for searching packaged food products via [Open Food Facts](https://world.openfoodfacts.org/), with detailed nutrition data gated behind a Stripe subscription. Built as a take-home technical assessment; supports English, Dutch, German, and French.

## Live demo

- **App**: https://food-finder.cdlegaspi.site
- **API**: https://food-finder-api.cdlegaspi.site (`GET /health`)

### Test accounts

The brief asks for "one demo user"; this project deliberately uses real login with 5 seeded accounts instead — see [Why real login instead of one demo user](#why-real-login-instead-of-one-demo-user) below for the reasoning. All 5 share one password (a portfolio project with pre-seeded, non-sensitive accounts — the hash is still real argon2id, never plaintext):

| Email | Password |
|---|---|
| `demo1@food-finder.local` … `demo5@food-finder.local` | `FoodFinderDemo!2026` |

Log in at `/en/login` (or `/nl`, `/de`, `/fr`). Use two different accounts in two browser sessions (or one in a private window) to see that subscriptions and search history are genuinely per-user, not shared.

To actually unlock nutrition info, subscribe with [Stripe's test card](https://docs.stripe.com/testing) `4242 4242 4242 4242`, any future expiry, any CVC — this is Stripe **test mode**, no real payment is made.

## Tech stack

Matches the brief's required stack exactly: **Frontend** — TypeScript, Next.js (App Router), React, Tailwind CSS v4. **Backend** — TypeScript, Express 5, Prisma 7, MySQL 8, Open Food Facts API, Stripe Subscriptions API (test mode).

## Getting started

Prerequisites: Node.js v24+, Docker + Docker Compose.

```bash
# 1. Install dependencies (npm workspaces, from the repo root)
npm install

# 2. Copy env files and fill in Stripe keys (see "Stripe setup" below)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# 3. Start MySQL + Adminer
docker compose up -d

# 4. Run migrations and seed the 5 demo accounts
cd apps/api
npm run prisma:migrate
npm run prisma:seed
cd ../..

# 5. Start both apps (separate terminals, from the repo root)
npm run dev:api   # http://localhost:4000
npm run dev:web   # http://localhost:3000/en
```

### Stripe setup (for local Checkout/webhook testing)

1. Create a Stripe account (or use an existing one) and switch to **test mode**.
2. Create a recurring monthly Price in the dashboard, copy its ID into `STRIPE_PRICE_ID`.
3. Copy your test-mode secret key into `STRIPE_SECRET_KEY`.
4. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli), run `stripe login` once, then forward webhooks to your local API:
   ```bash
   stripe listen --forward-to localhost:4000/api/webhooks/stripe
   ```
   Copy the `whsec_...` value it prints into `STRIPE_WEBHOOK_SECRET`.

Without this, search and login work fine locally; only the subscribe flow needs it.

## Testing

```bash
cd apps/api && npm test        # Vitest + Supertest, 67 tests across 4 files, OFF/Stripe/DB all mocked
cd apps/web && npm run test:e2e  # Playwright, real browser against the local dev stack
```

The Playwright suites need `docker compose up -d` plus both dev servers running:

- `locale-switching.spec.ts` (6 tests) — no external dependency
- `recent-searches.spec.ts` (6 tests) — no external dependency
- `login.spec.ts` (6 tests) — no external dependency
- `subscription-flow.spec.ts` (1 test) — drives a **real** Stripe test Checkout against `BASE_URL` (defaults to the live deployment) and cleans up the subscription it creates afterward; not run in CI for that reason

CI (`.github/workflows/ci.yml`) runs the Vitest suite (api), a production `next build` (web), and a build of both production Dockerfiles on every PR, then auto-deploys to production on merge to `master`.

## Project structure

```
apps/
  api/                       Express + Prisma (MySQL)
    src/modules/
      auth/                  login/logout/session, argon2id password hashing
      search/                Open Food Facts client, GET /api/search
      subscriptions/         Stripe Checkout + webhooks + gating middleware
      recent-searches/       per-user search history
    prisma/schema.prisma
  web/                       Next.js App Router + next-intl
    app/[locale]/            pages (search, login, subscribe success/cancel)
    components/              one folder per module
    messages/                en.json, nl.json, de.json, fr.json
docker-compose.yml           local MySQL + Adminer
```

The frontend calls the backend directly over HTTP (CORS-enabled), not through a Next.js proxy — the two services are genuinely independent, deployed and scaled separately.

## Technical decisions

### Open Food Facts integration

Free-text search does **not** work the way OFF's own most-visible docs suggest. `/api/v2/search` (the endpoint most tutorials use) only supports structured filters — passing `search_terms=` to it doesn't error, it silently ignores the filter and returns an unfiltered slice of the ~4.7M-product database (confirmed live: `search_terms=nutella` returned `count: 4727680`, i.e. nearly everything). The actual free-text search is a separate service, **Search-a-licious**, at `https://search.openfoodfacts.org/search`. This project uses that endpoint, with `langs` (not `lang`) for locale-aware matching and `fields` to keep the response shape small.

Records are normalized defensively: missing brand/image/nutriments are all real, common cases (not exceptions), a missing translated name falls back to another available language rather than rendering blank, and a slow/erroring OFF request returns a proper `504`/`502` instead of hanging or crashing the route.

Product images are also **not guaranteed to load even when OFF's search API returns a URL for them** — the image CDN and the search API are different hosts with independent uptime; a failed image load falls back to the same "no image" placeholder used when OFF has no image data at all, rather than a broken-image icon.

### Subscription gating

Enforced server-side, not just hidden in the UI: a middleware wraps the search route's JSON response and strips the `nutriments` field entirely unless the requesting user is logged in **and** `subscriptionStatus === 'active'` — an anonymous or unsubscribed request never receives the gated data over the wire, it isn't just styled to look hidden.

Stripe Checkout Session (`mode: subscription`) is created server-side; the backend returns the session URL and the frontend does a plain redirect, so no Stripe.js/publishable key is needed on the client. The webhook endpoint (raw body, signature-verified, mounted before the global JSON body parser) handles `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted` to keep each user's `subscriptionStatus` in sync — `checkout.session.completed` explicitly calls `stripe.subscriptions.retrieve()` rather than assuming the new subscription is `active`, since Stripe doesn't reliably fire `.updated` for a brand-new subscription.

### Why real login instead of one demo user

The brief specifies "use one demo user" and does not ask for login. That was the original plan, taken literally. It broke down in practice: a live, publicly reachable demo with one shared user means every visitor sees and can mutate the *same* subscription status — once anyone tested the subscribe flow, the demo user was permanently "active," so a reviewer opening the site fresh would only ever see the unlocked state, never the locked → subscribe → unlocked flow the assignment is actually about.

A scheduled job to periodically reset the demo user's subscription state was considered and would have stayed faithful to the brief, but real login (email/password, 5 seeded accounts, session-based) was chosen instead: it gives each reviewer session a clean, independent state without a race against a reset timer, and demonstrates a genuine per-user data model rather than a single mutable row. This is a deliberate deviation from the literal brief, not an oversight — `Session` is a DB-backed table (SHA-256-hashed tokens, not a JWT) so logout and webhook-driven subscription changes take effect immediately rather than waiting for a token to expire; passwords are hashed with argon2id (checked against OWASP's current guidance, which now treats bcrypt as legacy-only); login always runs the password verification step even for an unknown email, so response timing can't reveal whether an address is registered.

### Recent searches — dedup behavior

Re-running a query that already appears anywhere in a user's history bumps that entry's timestamp (moving it to the top) instead of inserting a duplicate — whether it's an immediate repeat or resurfaces after other searches happened in between. A query can only ever occupy one slot in the panel. History is capped at the 10 most recent per user; the underlying table isn't pruned, only what's returned/rendered is.

### Deployment

Self-hosted on a Dokploy VPS: `apps/web` and `apps/api` as separate Dockerfile builds behind Traefik/Let's Encrypt, on their own subdomains, plus a managed MySQL instance. Production images build from a multi-stage Dockerfile and run without the Prisma CLI or dev dependencies — migrations are applied via a one-off deploy using the Dockerfile's intermediate `build` stage (which still has the CLI) rather than exposing the database externally. CI builds and tests every PR, then auto-deploys to production on merge to `master` (polls Dokploy until the deploy actually completes, then runs a real health check against both live URLs — a 2xx from the deploy trigger only means "accepted," not "live").

## Internationalization

- Locale-prefixed routing (`/en`, `/nl`, `/de`, `/fr`) via `next-intl`, with the manual language switcher the brief asks for. `next-intl`'s default Accept-Language-based detection is also active on a first visit with no locale cookie yet — the switcher is what lets a user override it explicitly, and that choice is what persists afterward.
- All UI strings live in `apps/web/messages/{en,nl,de,fr}.json`; every key is present in all four files (no fallback-to-English gaps).
- Product data (name, brand) is requested from Open Food Facts in the selected locale via Search-a-licious's `langs` parameter; when OFF has no translation for a product in the selected language, the service falls back to another language it does have rather than showing a blank field — OFF's own data coverage varies a lot by language and product, so this is a real, common case rather than an edge case.
- The language switcher preserves the current page across a locale change (e.g. switching from `/en/subscribe/success` goes to `/fr/subscribe/success`, not back to the homepage).

## Known limitations

- **No self-service signup.** The 5 seeded accounts are the only way to log in — appropriate for a reviewable demo, not how this would ship as a real product.
- **No OFF response caching.** Every search hits Search-a-licious live; fine for a demo's traffic level, would need caching (or a local product mirror) at real scale.
- **`RecentSearch` has no foreign key back to `User`** in the schema (a plain indexed `userId` column) — matches how the table was originally scoped to a single hardcoded demo user and was never revisited when accounts were introduced; referential integrity is enforced at the application layer (every query scopes by the authenticated user's id) rather than the database layer.
- **The live demo's Stripe subscription is real Stripe test-mode data**, not mocked — subscribing during review creates an actual (test-mode) Stripe subscription against this project's Stripe account. Harmless (no real charge, test mode), but worth knowing before repeatedly testing the flow.
- **Session cookies last 7 days** with no "remember me" distinction — a deliberate simplification, not tuned for a specific security posture.

## Use of AI

Built with Claude Code as a development tool throughout — for implementation, debugging, and researching current library/API behavior (Open Food Facts' actual search endpoint, Stripe's Node SDK, OWASP's current password-hashing guidance) rather than relying on potentially outdated training data. Every feature was verified manually against a running instance (local and/or the live deployment) before being considered done — not just written and assumed correct. I'm able to explain, debug, and modify any part of this codebase during review.
