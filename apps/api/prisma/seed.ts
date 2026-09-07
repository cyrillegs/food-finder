// Idempotent seed: creates (or leaves alone) 5 demo User accounts, replacing
// the single fixed DemoUser row Modules 0-5 used before real login existed.
// Five separate accounts (not one) exist specifically so a reviewer can log
// in as two different users and see that Subscriptions/Recent Searches are
// genuinely per-user now, not shared state - the whole point of this
// change (see the PR description).
//
// All 5 share one password: this is a portfolio/demo project with
// pre-seeded, non-sensitive accounts, not a real security-sensitive system
// - a single memorable password is more useful to a reviewer here than 5
// random ones they'd have to look up individually. It's still hashed
// properly (argon2id, the same real hashing path apps/api/src/modules/auth
// uses for real logins - see auth.service.ts's hashPassword), not stored in
// plaintext.
import 'dotenv/config';
import { prisma } from '../src/shared/prisma';
import { hashPassword } from '../src/modules/auth/auth.service';

const DEMO_ACCOUNT_COUNT = 5;
const DEMO_PASSWORD = 'FoodFinderDemo!2026';

function demoEmail(n: number): string {
  return `demo${n}@food-finder.local`;
}

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (let n = 1; n <= DEMO_ACCOUNT_COUNT; n += 1) {
    const email = demoEmail(n);
    const user = await prisma.user.upsert({
      where: { email },
      // Deliberately does NOT reset passwordHash on an existing row: this
      // seed is meant to be safe to re-run against a database where a
      // subscription was already exercised for one of these accounts (real
      // Stripe customer/subscription history, same discipline the old
      // DemoUser seed followed) - only the initial `create` sets a
      // password hash. If you actually need to reset a demo account's
      // password, delete its row first rather than re-running this seed.
      update: {},
      create: { email, passwordHash },
    });

    console.log('Seeded User:', { id: user.id, email: user.email });
  }

  console.log(`\nAll ${DEMO_ACCOUNT_COUNT} demo accounts share the password: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
