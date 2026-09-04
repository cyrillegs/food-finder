// Prisma client singleton. In dev, `tsx watch` re-executes this module on
// every file change; without caching the instance on `globalThis` each reload
// would open a fresh pool of DB connections until they're exhausted. This is
// the standard Node/Prisma hot-reload-safe pattern.
//
// Prisma 7 requires a driver adapter for MySQL (plain `new PrismaClient()`
// throws "A driver adapter is required to connect to your database"). The
// mariadb driver's pool accepts the DATABASE_URL connection string directly,
// so no discrete host/user/password env vars are needed.
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const adapter = new PrismaMariaDb(process.env.DATABASE_URL as string);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
