// Idempotent seed: creates (or leaves alone) a single fixed DemoUser row that
// the rest of the app can use as "the" demo account before real auth exists.
import 'dotenv/config';
import { prisma } from '../src/shared/prisma';

const DEMO_USER_EMAIL = 'demo@food-finder.local';

async function main() {
  const demoUser = await prisma.demoUser.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: {},
    create: {
      email: DEMO_USER_EMAIL,
    },
  });

  console.log('Seeded DemoUser:', demoUser);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
