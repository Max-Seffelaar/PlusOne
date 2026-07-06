// Stripe webhook endpoint (decision #32) — the only inbound server-to-server
// route in the app. There is deliberately no user session here: authentication
// is the Stripe signature over the RAW request body, and every write goes
// through the service-role RPC apply_stripe_subscription_update, confined to
// src/features/billing/ (the documented service-role exception, CLAUDE.md
// §Billing). Requests never carry PII beyond Stripe ids; responses are generic.

import { handleStripeWebhook } from '@/features/billing/stripe-webhook';

// Signature verification requires the exact raw bytes — no framework parsing.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature') ?? '';
  const { status, body } = await handleStripeWebhook(rawBody, signature);
  return new Response(body, { status });
}
