#!/usr/bin/env node
// Billing-mails B1 (z8uq9m2z19): run the billing-mail job by hand against the
// LOCAL stack, the way pg_cron does it on prod (mint a single-use token,
// POST it to /api/webhooks/billing-mails), and print the run's totals. The
// mails land in Mailpit (http://127.0.0.1:55324).
//
//   pnpm billing-mails:local            one job run
//   pnpm billing-mails:local --demo     first set up one company per mail
//                                        (all seven), then run
//
// --demo creates six "Demo …" companies with admin@plusone.test as admin:
// five trials whose mail moment was an hour ago (day 0, 7, 12, 14, 21) and
// one paying company that gets a Stripe payment-failed and a canceled event
// through the same RPCs the Stripe webhook uses. Idempotent ids: a second
// --demo run sends nothing new (each mail goes once); `pnpm db:fresh` starts
// over.
//
// Local only, by construction: it refuses any database that is not on
// 127.0.0.1/localhost and any app URL that is not localhost. Needs `pnpm dev`
// running (PORT, default 7000).

import { randomBytes } from 'node:crypto';
import pg from 'pg';

const PGURL = process.env.PGURL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
const APP = process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? '7000'}`;

function assertLocal() {
  const db = new URL(PGURL).hostname;
  const app = new URL(APP).hostname;
  const local = (h) => h === '127.0.0.1' || h === 'localhost';
  if (!local(db) || !local(app)) {
    console.error(`billing-mails-local: refusing a non-local target (db ${db}, app ${app}).`);
    process.exit(1);
  }
}

const ADMIN = '11111111-1111-4111-8111-111111111111'; // admin@plusone.test (seed)
const DEMO = [
  ['dd000000-0000-7000-8000-0000000000a0', 'Demo Day 0', "now() - interval '1 hour'"],
  ['dd000000-0000-7000-8000-0000000000a7', 'Demo Day 7', "now() - interval '7 days 1 hour'"],
  ['dd000000-0000-7000-8000-0000000000b2', 'Demo Day 12', "now() - interval '12 days 1 hour'"],
  ['dd000000-0000-7000-8000-0000000000b4', 'Demo Day 14', "now() - interval '14 days 1 hour'"],
  ['dd000000-0000-7000-8000-0000000000c1', 'Demo Day 21', "now() - interval '21 days 1 hour'"],
];
const STRIPE_VENUE = 'dd000000-0000-7000-8000-0000000000f0';

async function demo(client) {
  for (const [id, name, createdAt] of [...DEMO, [STRIPE_VENUE, 'Demo Stripe', "now() - interval '40 days'"]]) {
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    await client.query('insert into public.venues (id, name, slug) values ($1, $2, $3) on conflict (id) do nothing', [
      id,
      name,
      slug,
    ]);
    await client.query(
      `insert into public.subscriptions (venue_id, status, plan_id, created_at, stripe_customer_id)
       values ($1, 'trialing', 'pro', ${createdAt}, $2)
       on conflict (venue_id) do update set created_at = excluded.created_at`,
      [id, id === STRIPE_VENUE ? 'cus_demo_stripe' : null]
    );
    await client.query(
      `insert into public.venue_memberships (venue_id, user_id, roles) values ($1, $2, '{admin}')
       on conflict (venue_id, user_id) do nothing`,
      [id, ADMIN]
    );
  }
  // The Stripe events, through the webhook's own two RPCs.
  for (const [evt, type, status] of [
    ['evt_demo_payment_failed', 'invoice.payment_failed', 'past_due'],
    ['evt_demo_deleted', 'customer.subscription.deleted', 'canceled'],
  ]) {
    await client.query(
      `select public.apply_stripe_subscription_update($1, $2, null, 'cus_demo_stripe', null,
         $3::public.subscription_status, null, null, now())`,
      [evt, type, status]
    );
    await client.query("select public.enqueue_billing_event_mail($1, 'cus_demo_stripe', now())", [evt]);
  }
  console.log('billing-mails-local: demo companies ready (5 trials + 1 Stripe company).');
}

async function main() {
  assertLocal();
  const client = new pg.Client({ connectionString: PGURL });
  await client.connect();
  let token;
  try {
    if (process.argv.includes('--demo')) await demo(client);
    token = randomBytes(32).toString('hex');
    await client.query(
      "insert into public.billing_mail_tokens (token_hash) values (extensions.digest($1, 'sha256'))",
      [token]
    );
  } finally {
    await client.end();
  }

  const res = await fetch(`${APP}/api/webhooks/billing-mails`, {
    method: 'POST',
    headers: { 'x-billing-mails-token': token },
  });
  console.log(`billing-mails-local: ${res.status} ${await res.text()}`);
  console.log('Mailpit: http://127.0.0.1:55324');
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error('billing-mails-local failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
