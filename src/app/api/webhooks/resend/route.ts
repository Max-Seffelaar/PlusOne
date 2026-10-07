// Resend webhook endpoint (Mail-infra F0, z8uq9m2yvt). Like the Stripe route
// next door there is no user session: the middleware exempts /api/webhooks/,
// and authentication is the Svix signature over the RAW body with
// the webhook secret (src/features/mail/config.ts). Every write goes through the service-role RPC
// apply_resend_webhook_event, confined to src/features/mail/. Responses are
// generic; nothing from the payload is echoed or logged beyond the Svix id.

import { handleResendWebhook } from '@/features/mail/resend-webhook';

// Signature verification needs the exact raw bytes: no framework parsing.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const { status, body } = await handleResendWebhook(rawBody, {
    id: req.headers.get('svix-id'),
    timestamp: req.headers.get('svix-timestamp'),
    signature: req.headers.get('svix-signature'),
  });
  return new Response(body, { status });
}
