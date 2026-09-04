import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  // Don't auto-generate AGENTS.md/CLAUDE.md into the app directory.
  agentRules: false,
};

// Picks up ./i18n/request.ts by convention.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
