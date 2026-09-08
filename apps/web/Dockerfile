# syntax=docker/dockerfile:1
#
# apps/web/Dockerfile - production image for the Food Finder web app
# (Next.js 16 App Router).
#
# IMPORTANT: build context MUST be the repo root, NOT apps/web, e.g.:
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com \
#     -t food-finder-web .
#
# Why the repo-root context: same reason as apps/api/Dockerfile - this is an
# npm workspaces monorepo ("workspaces": ["apps/*"]), which hoists shared
# dependencies to the ROOT node_modules. `npm ci` needs the root
# package.json/package-lock.json to resolve the workspace at all, and
# next.config.ts sets `outputFileTracingRoot` to the repo root so Next's
# build-output tracing follows dependencies up into that hoisted
# node_modules instead of assuming apps/web is the project root (verified
# locally: without outputFileTracingRoot, the docs note file tracing misses
# anything outside the app directory in a monorepo).
#
# IMPORTANT (build-time vs runtime env): NEXT_PUBLIC_API_BASE_URL is read by
# client-side code and gets INLINED into the static JS bundle at
# `next build` time - per Next.js's own docs on NEXT_PUBLIC_* vars, setting
# it at `docker run` time on the container has NO effect once the image is
# built. It must be supplied via `--build-arg` at `docker build` time (as
# above). Baking the wrong value in here means the deployed site silently
# calls the wrong API URL with no error - there is no way to override it
# short of rebuilding the image.
#
# Dokploy (or any other Dockerfile-based deploy config) must set the build
# context to the repo root, point at this file with -f apps/web/Dockerfile,
# and supply NEXT_PUBLIC_API_BASE_URL as a build arg, not a runtime env var.

# Next.js's own current official multi-stage example (fetched via context7,
# github.com/vercel/next.js examples/with-docker at v16.2.9) uses a Debian
# "slim" base rather than alpine. Followed here deliberately instead of the
# alpine image used for apps/api: apps/web's traced standalone output pulls
# in `sharp` (an optional native-binary dependency of `next` used for image
# optimization), and Debian slim avoids the musl-libc native-addon
# compatibility issues alpine is known for with that kind of package. (The
# API image has no native-binary dependencies - its mysql driver and Prisma's
# query engine are pure JS / wasm - so alpine is fine there.)
ARG NODE_VERSION=24-slim

# -----------------------------------------------------------------------------
# Stage 1: deps - install ALL workspace dependencies (incl. devDependencies:
# typescript and @types/*, which `next build`'s type-checking step needs).
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Only the manifests npm needs to resolve this one workspace member - not the
# whole repo. apps/api/package.json is deliberately NOT copied (not needed to
# build or run the web app), same reasoning as apps/api/Dockerfile in
# reverse.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json

RUN --mount=type=cache,target=/root/.npm \
    npm ci

# -----------------------------------------------------------------------------
# Stage 2: builder - `next build` with output: 'standalone'.
# -----------------------------------------------------------------------------
FROM deps AS builder
WORKDIR /app

# Broad copy of the workspace member's own source is fine here (unlike the
# deps stage above): .dockerignore excludes node_modules and .next so this
# can't pull in stale/host build output.
COPY apps/web ./apps/web

# This scaffold has no apps/web/public directory yet. Standalone output never
# includes `public/` regardless (see the runner stage below), but `COPY
# --from=builder .../public` there would fail outright if the directory
# doesn't exist at all. Guarantee it exists so the Dockerfile keeps working
# unchanged whether or not a public/ directory (with real assets) is added
# later.
RUN mkdir -p apps/web/public

ARG NEXT_PUBLIC_API_BASE_URL
# NEXT_PUBLIC_* vars are inlined into the client bundle by `next build` - see
# the big comment at the top of this file. Exporting the ARG as an ENV here
# is what makes that value visible to the build step below.
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
# The site's OWN public origin, used only to build absolute Open Graph URLs
# (see app/[locale]/layout.tsx). Distinct from the API origin above. If it is
# missing the app still works, but link previews fall back to localhost, so
# it is passed at build time alongside the API URL rather than at runtime.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NODE_ENV=production

RUN npm run build --workspace=@food-finder/web

# -----------------------------------------------------------------------------
# Stage 3: runner - lean production image serving the standalone server.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Must bind 0.0.0.0, not the default localhost-only bind, or the container's
# published port is unreachable from outside it.
ENV HOSTNAME=0.0.0.0

# `output: 'standalone'` traces only the files/deps this app actually needs
# (verified locally: ~28MB of node_modules vs. the monorepo's full hoisted
# install) into .next/standalone, laid out as:
#   .next/standalone/node_modules        <- hoisted deps, traced+pruned
#   .next/standalone/apps/web/server.js  <- entry point
#   .next/standalone/apps/web/.next/...  <- server-side build output
# Copying its contents to ./ reproduces that same layout at /app, so
# server.js's own relative module resolution (and Node's node_modules
# lookup, walking up from apps/web/server.js) keeps working unmodified.
COPY --from=builder /app/apps/web/.next/standalone ./

# GOTCHA called out in the task and confirmed locally: standalone output does
# NOT include static assets by default - `.next/standalone/apps/web/.next`
# has no `static/` subfolder, and there is no `public/` at all under
# standalone. Both must be copied in explicitly at the exact nested path
# server.js expects, or the app "works" (returns HTML) while every
# _next/static/* asset 404s.
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
