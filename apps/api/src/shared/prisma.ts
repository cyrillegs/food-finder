// Prisma client singleton. In dev, `tsx watch` re-executes this module on
// every file change; without caching the instance on `globalThis` each reload
// would open a fresh pool of DB connections until they're exhausted. This is
// the standard Node/Prisma hot-reload-safe pattern.
//
// Prisma 7 requires a driver adapter for MySQL (plain `new PrismaClient()`
// throws "A driver adapter is required to connect to your database").
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// DATABASE_URL is parsed into discrete fields rather than passed straight
// through as a string - confirmed empirically that a bare `mysql://` string
// here reaches MySQL 8.4's `caching_sha2_password` auth stage and then hangs
// until the connection pool's acquire timeout, failing every real query with
// `ER_CANNOT_RETRIEVE_RSA_KEY`. This went unnoticed until now because no
// endpoint has ever run a live query through this adapter before (Search
// hits Open Food Facts, not the database; /health touches neither) - it's a
// latent bug from module 0, not something introduced later.
// `allowPublicKeyRetrieval` is what MySQL's own docs recommend for a non-TLS
// connection using that auth plugin (this local/demo setup has no TLS
// configured); confirmed this exact option fixes it, tested against a real
// query. Revisit if this project's Dokploy deployment ever needs TLS to
// MySQL - the safer alternative there is enabling TLS instead of this flag.
const dbUrl = new URL(process.env.DATABASE_URL as string);
const adapter = new PrismaMariaDb({
  host: dbUrl.hostname,
  port: dbUrl.port ? Number(dbUrl.port) : 3306,
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  database: dbUrl.pathname.replace(/^\//, ''),
  allowPublicKeyRetrieval: true,
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
