import 'server-only';

// Resend webhook processing (Mail-infra F0, z8uq9m2yvt). Resend signs every
// delivery the Svix way: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${raw
// body}` with the base64 secret after the `whsec_` prefix; `svix-signature`
// holds one or more space-separated `v1,<base64>` candidates. Verified here
// with node:crypto (constant-time compare), checked against Svix's published
// test vector in resend-webhook.test.ts.
//
// Then: map the event to a status and apply it through the service-role RPC
// apply_resend_webhook_event, whose resend_webhook_events ledger makes a
// replay a no-op (the Stripe pattern). Nothing in here logs a body, an
// address or a subject; only the Svix id and the event type.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { mailConfig } from './config';
import { answerInbound, defaultInboundDeps, type InboundDeps } from './inbound';

/** Svix's own default: a delivery older or newer than 5 minutes is refused. */
export const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
/** Resend event payloads are a few KB; anything this big is not one of them. */
const MAX_BODY_BYTES = 256 * 1024;

export const HANDLED_EVENT_TYPES = [
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.delivery_delayed',
  // Inbound (Resend receiving) on noreply@: the guest-mail auto-reply.
  'email.received',
] as const;

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

function secretBytes(secret: string): Buffer | null {
  const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const bytes = Buffer.from(raw, 'base64');
  return bytes.length > 0 ? bytes : null;
}

/**
 * True when the headers carry a valid v1 signature over this exact raw body,
 * within the timestamp tolerance. Any missing piece is false, never a throw.
 */
export function verifySvixSignature(
  rawBody: string,
  headers: SvixHeaders,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const sentAt = Number(timestamp);
  if (Math.abs(nowSeconds - sentAt) > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const key = secretBytes(secret);
  if (!key) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();

  for (const candidate of signature.split(' ')) {
    const [version, value] = candidate.split(',', 2);
    if (version !== 'v1' || !value) continue;
    const given = Buffer.from(value, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

const eventSchema = z.object({
  type: z.string().min(1).max(100),
  data: z
    .object({ email_id: z.string().min(1).max(200).optional() })
    .passthrough()
    .optional(),
});

export interface WebhookResult {
  status: number;
  body: string;
}

/**
 * Verify + map + apply one delivery. Response contract for Resend/Svix:
 * 2xx = processed (incl. replays, unhandled types and unparseable payloads,
 *       which can never succeed on redelivery),
 * 400 = bad or missing signature, 413 = oversized body,
 * 503 = webhook secret not configured (nothing is processed),
 * 500 = transient DB failure (Svix retries with backoff).
 */
export async function handleResendWebhook(
  rawBody: string,
  headers: SvixHeaders,
  inboundDeps: () => InboundDeps = defaultInboundDeps,
): Promise<WebhookResult> {
  if (!mailConfig.webhookSecret) return { status: 503, body: 'not configured' };
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return { status: 413, body: 'too large' };
  if (!verifySvixSignature(rawBody, headers, mailConfig.webhookSecret)) {
    return { status: 400, body: 'invalid signature' };
  }
  // Verified, so the id is present.
  const eventId = headers.id as string;

  let parsed: z.infer<typeof eventSchema>;
  try {
    const result = eventSchema.safeParse(JSON.parse(rawBody));
    if (!result.success) return { status: 200, body: 'ignored' };
    parsed = result.data;
  } catch {
    return { status: 200, body: 'ignored' };
  }

  if (!(HANDLED_EVENT_TYPES as readonly string[]).includes(parsed.type)) {
    return { status: 200, body: 'ignored' };
  }

  const supabase = createServiceClient();
  const { data: applied, error } = await supabase.rpc('apply_resend_webhook_event', {
    p_event_id: eventId,
    p_event_type: parsed.type,
    p_provider_message_id: parsed.data?.email_id ?? undefined,
  });
  if (error) {
    console.error('resend webhook apply failed', { eventId, type: parsed.type, code: error.code });
    return { status: 500, body: 'processing failed' };
  }
  if (!applied) return { status: 200, body: 'replay' };

  // The ledger row exists now, so a redelivery of this inbound mail is a
  // replay above and never answers twice. A failed answer is not retried.
  if (parsed.type === 'email.received') {
    const outcome = await answerInbound(eventId, (parsed.data ?? {}) as Record<string, unknown>, inboundDeps());
    if (outcome === 'failed') console.error('resend inbound auto-reply failed', { eventId });
  }
  return { status: 200, body: 'ok' };
}
