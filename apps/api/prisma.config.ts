// Prisma 7 no longer reads the datasource URL from schema.prisma or auto-loads
// .env files for CLI commands (migrate, db seed, etc.) - both are supplied here.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  engine: 'classic',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
