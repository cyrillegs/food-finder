// Backstop for the acknowledged webhook-gap: subscriptionStatus only ever
// updates when a Stripe webhook successfully lands, so a lost webhook (a
// network blip, a Stripe outage) leaves that user's row stale forever with
// nothing else to correct it. Run this on a schedule (Dokploy's job
// scheduler, or any cron) to re-check every user who has been through
// Checkout directly against Stripe and heal any drift - see
// reconcileAllSubscriptions in subscriptions.service.ts for the actual
// logic.
//
// Run manually with: npm run reconcile --workspace apps/api
import 'dotenv/config';
import { reconcileAllSubscriptions } from '../modules/subscriptions/subscriptions.service';
import { prisma } from '../shared/prisma';

async function main() {
  const results = await reconcileAllSubscriptions();
  const changed = results.filter((r) => r.changed);

  console.log(`Checked ${results.length} user(s) with a Stripe customer id.`);
  if (changed.length === 0) {
    console.log('No drift found - every local subscriptionStatus matches Stripe.');
    return;
  }

  console.log(`Healed ${changed.length} drifted row(s):`);
  for (const r of changed) {
    console.log(`  ${r.email}: ${r.previousStatus} -> ${r.currentStatus}`);
  }
}

main()
  .catch((err) => {
    console.error('Reconciliation failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
