# Food Finder

Search packaged food products via Open Food Facts, with detailed nutrition data
gated behind a Stripe subscription. Portfolio project, 4 languages (en, nl, de,
fr).

This is **Module 0: scaffold + shared plumbing** - the empty skeleton the
feature modules (Search, Subscriptions, i18n, Recent Searches) plug into. No
feature logic lives here yet.

## Layout

- `apps/api` - Express + Prisma (MySQL) API
- `apps/web` - Next.js (App Router) + next-intl frontend

## Prerequisites

- Node.js (v24+)
- Docker + Docker Compose

## Getting started

1. Install dependencies (npm workspaces, run once from the repo root):

   ```bash
   npm install
   ```

2. Copy the env files and fill in as needed:

   ```bash
   cp apps/api/.env.example apps/api/.env
   cp apps/web/.env.example apps/web/.env
   ```

3. Start MySQL + Adminer:

   ```bash
   docker compose up -d
   ```

   MySQL is exposed on `localhost:3307`, Adminer on `http://localhost:8082`.

4. Run the initial migration and seed the dev database:

   ```bash
   cd apps/api
   npm run prisma:migrate
   npm run prisma:seed
   ```

5. Start both apps in dev mode (from the repo root, in separate terminals):

   ```bash
   npm run dev:api   # http://localhost:4000 (GET /health)
   npm run dev:web   # http://localhost:3000/en
   ```

Full technical write-up (decisions, known limitations) comes later in the
cross-module pass - this README stays intentionally minimal for now.
