import 'server-only';

// Resend over plain fetch (Mail-infra F0). One endpoint, one header set: the
// official `resend` SDK would add a dependency (and its transitive tree) for a
// single POST, and its webhook helper is a wrapper around `svix`, which we
// verify ourselves in resend-webhook.ts against Svix's published test vector.
// Confined to src/features/mail/ by src/features/mail/mail-confinement.test.ts.

import { MAIL_FROM } from './config';
import type { MailFailureCode, MailProvider, OutgoingMail, SendResult } from './provider';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
/** A send blocks the invite action that triggered it; never longer than this. */
const SEND_TIMEOUT_MS = 8000;

/** Resend's 429 `name` values that mean "stop for now", per their error docs. */
function failureFor429(name: unknown): MailFailureCode {
  if (name === 'daily_quota_exceeded') return 'daily_quota_exceeded';
  if (name === 'monthly_quota_exceeded') return 'monthly_quota_exceeded';
  return 'rate_limited';
}

export class ResendAdapter implements MailProvider {
  constructor(private readonly apiKey: string) {}

  async send(mail: OutgoingMail): Promise<SendResult> {
    let res: Response;
    try {
      res = await fetch(RESEND_EMAILS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': mail.idempotencyKey,
        },
        body: JSON.stringify({
          from: mail.from ?? MAIL_FROM,
          to: [mail.to],
          ...(mail.replyTo ? { reply_to: [mail.replyTo] } : {}),
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          tags: [{ name: 'type', value: mail.type }],
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      return { ok: false, errorCode: timedOut ? 'timeout' : 'network' };
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

    if (res.ok) {
      return { ok: true, providerMessageId: typeof record.id === 'string' ? record.id : null };
    }

    // Status + Resend's error `name` only: the `message` can quote the address.
    const name = typeof record.name === 'string' ? record.name : null;
    console.error('resend send failed', { status: res.status, name, type: mail.type });
    if (res.status === 429) return { ok: false, errorCode: failureFor429(name) };
    return { ok: false, errorCode: res.status >= 500 ? 'provider_unavailable' : 'provider_rejected' };
  }
}
