# syntax=docker/dockerfile:1
#
# apps/api/Dockerfile - production image for the Food Finder API.
#
# IMPORTANT: build context MUST be the repo root, NOT apps/api, e.g.:
#
#   docker build -f apps/api/Dockerfile -t food-finder-api .
#
# Why: this is an npm workspaces monorepo (root package.json has
# "workspaces": ["apps/*"]). npm hoists shared dependencies to the ROOT
# node_modules instead of apps/api/node_modules - including the Prisma
# client. Verified empirically in this repo: after `npm run build` and
# `npx prisma generate`, the client lives at
#   <repo-root>/node_modules/@prisma/client       (installed package shell)
#   <repo-root>/node_modules/.prisma/client        (schema-specific generated
#                                                    code + wasm query engine)
# apps/api/node_modules has neither. Building with apps/api as the context
# would have no access to the root package.json/package-lock.json needed to
# resolve the workspace in the first place, and no way to pick up that
# hoisted output. Node's own module resolution walks up from
# apps/api/dist/*.js through apps/api/node_modules (absent) to the repo
# root's node_modules (present) - so as long as the final image preserves
# the same `<root>/node_modules` + `<root>/apps/api/dist` layout, requiring
# '@prisma/client' from compiled code resolves correctly. This is also why
# the runtime stage below is laid out at /app with /app/apps/api/dist nested
# under /app/node_modules, mirroring the repo shape, instead of flattening.
#
# Dokploy (or any other Dockerfile-based deploy config) must set the build
# context to the repo root and point at this file with -f apps/api/Dockerfile.

ARG NODE_VERSION=24-alpine

# -----------------------------------------------------------------------------
# Stage 1: deps - install ALL workspace dependencies (incl. devDependencies:
# typescript, the prisma CLI) needed to build the API.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Only the manifests npm needs to resolve this one workspace member - not the
# whole repo. apps/web/package.json is deliberately NOT copied: verified that
# `npm ci` at the workspace root succeeds without it (npm just skips creating
# a workspace symlink for the workspace member that isn't present); it is not
# needed to build or run the API.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json

RUN --mount=type=cache,target=/root/.npm \
    npm ci

# -----------------------------------------------------------------------------
# Stage 2: build - compile TypeScript and generate the Prisma client.
# -----------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

# Broad copy of the workspace member's own source is fine here (unlike the
# deps stage above): .dockerignore excludes node_modules and dist so this
# can't pull in stale/host build output.
COPY apps/api ./apps/api

# `prisma generate` needs no DATABASE_URL/DB connectivity (verified locally:
# it succeeds with the env var unset) - it only reads prisma/schema.prisma
# and writes generated client code. Because @prisma/client is hoisted, this
# writes into <root>/node_modules/.prisma/client, alongside the
# node_modules/@prisma/client package shell already installed in stage 1.
#
# MUST run before `tsc` below, not after: as installed by plain `npm ci`,
# @prisma/client is an empty shell with no generated types yet, so
# src/shared/prisma.ts's `import { PrismaClient } from '@prisma/client'`
# fails to type-check until this has run (confirmed by getting a
# TS2305 "has no exported member 'PrismaClient'" build failure with the
# steps in the other order).
#
# apps/api/prisma.config.ts resolves `env('DATABASE_URL')` eagerly while
# loading the config, even for `generate` (which never actually connects to
# a database) - confirmed by hitting a PrismaConfigEnvError here with no
# DATABASE_URL set. Locally this is masked by prisma.config.ts's own
# `import 'dotenv/config'` picking up apps/api/.env; that file is
# deliberately excluded from the build context (.dockerignore) so no real
# secret/URL is ever baked into an image layer. This placeholder only needs
# to be a syntactically valid connection string - it is never connected to.
ENV DATABASE_URL="mysql://placeholder:placeholder@localhost:3306/placeholder"
RUN npm exec -w @food-finder/api -- prisma generate

RUN npm run build --workspace=@food-finder/api

# -----------------------------------------------------------------------------
# Stage 3: runner - lean production image. No TypeScript, no dev
# dependencies, no source .ts files.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production

# Fresh production-only install (no tsc, no prisma CLI, no vitest, etc.) -
# keeps the runtime image lean. This does NOT run `prisma generate`, so
# node_modules/.prisma is intentionally absent after this step.
#
# --omit=dev alone is NOT enough here: @prisma/client declares a
# peerDependency on the full `prisma` CLI package, and npm auto-installs
# peer deps to satisfy that even under --omit=dev. That silently dragged in
# the ~40MB `prisma` CLI plus its own dependencies - @prisma/studio-core
# (~42MB, Prisma Studio's UI/backend), @prisma/dev (~19MB, the `prisma dev`
# local proxy), @prisma/engines (~22MB, migration/schema engine binaries),
# and their transitive deps (effect, @electric-sql/pglite, elkjs, remeda,
# ~65MB more) - roughly 370MB of node_modules, none of it needed to run the
# compiled server (confirmed by tracing the lockfile: none of those packages
# appear in @prisma/client's, @prisma/adapter-mariadb's, or
# @prisma/client-runtime-utils's own `dependencies`, only in `prisma`'s).
# --omit=peer --omit=optional prunes that whole peer-only subtree (npm marks
# it "devOptional" in the lockfile), bringing node_modules down to ~81MB
# containing only what's actually required: express/cors/dotenv,
# @prisma/client, @prisma/adapter-mariadb (+ its own mariadb driver dep),
# @prisma/client-runtime-utils, @prisma/driver-adapter-utils, @prisma/debug.
# Verified this minimal set still works end-to-end: ran a real
# `prisma.demoUser.findMany()` query inside a container built from this exact
# install against the project's dev MySQL container and got real rows back
# (see PR description) - not just "the build succeeded".
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --omit=peer --omit=optional

# The gotcha this task called out: node_modules/@prisma/client installed
# above is just a thin shell (runtime/ helpers + re-exports) - the actual
# schema-specific generated code and query engine live in
# node_modules/.prisma/client, which only `prisma generate` produces (stage
# 2). Without copying it in, `require('@prisma/client')` resolves to a
# package that immediately throws at runtime. Copy the whole directory
# rather than hand-picking files inside it, since its exact contents
# (wasm query engine, schema.prisma copy, generated index.js) are internal to
# Prisma and not worth hard-coding.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Compiled output only.
COPY --from=build /app/apps/api/dist ./apps/api/dist

EXPOSE 4000

# Deliberately NOT running `prisma migrate deploy` here. With multiple
# replicas, this container's CMD would run concurrently on every replica and
# race against the same database applying the same migration - unsafe.
# Migrations are a separate, one-time deploy step run externally (e.g.
# Dokploy's pre-deploy command, or manually against the target database),
# never part of container startup.
CMD ["node", "apps/api/dist/index.js"]
