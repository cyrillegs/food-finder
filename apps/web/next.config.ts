import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  // Don't auto-generate AGENTS.md/CLAUDE.md into the app directory.
  agentRules: false,

  // Minimal, self-contained production server for Docker (see
  // apps/web/Dockerfile): traces only the files/deps this app actually needs
  // into .next/standalone, instead of shipping the whole node_modules tree.
  output: 'standalone',

  // This is an npm workspaces monorepo (root package.json has
  // "workspaces": ["apps/*"]), which hoists shared dependencies up to the
  // repo-root node_modules. Without pointing the tracing root at the repo
  // root, Next.js treats apps/web as the root, misses the hoisted deps, and
  // produces an incomplete/broken standalone build.
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

// Picks up ./i18n/request.ts by convention.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
