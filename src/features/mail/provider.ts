import 'server-only';

// Mail abstraction (Mail-infra F0, z8uq9m2yvt), the billing pattern
// (src/features/billing/provider.ts): the app never calls Resend directly.
// Every send goes through a MailProvider, so swapping the provider touches only
// this directory (a vitest guard keeps `resend` and the API host in here).
// Without the Resend API key the stub serves local dev and tests: it logs the send
// WITHOUT the address and reports success with no provider id. On the local
// stack only (see localMailCatcher) it also hands the mail to the stack's
// Mailpit, so a developer or a flow can read what would have gone out.

import { mailConfig } from './config';
import { ResendAdapter } from './resend-adapter';
import { onLocalDevStack } from '@/lib/local-stack';

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** mail_log row id: one key per row, so a retried send never mails twice. */
  idempotencyKey: string;
  /** Mail type, sent as a provider tag (ASCII, no PII). */
  type: string;
  /** Sender override (billing mail: support@); default MAIL_FROM. */
  from?: string;
  /** Reply-To address (billing mail: support@, answered by the team). */
  replyTo?: string;
  /** Extra headers (guest mail: List-Unsubscribe + List-Unsubscribe-Post). */
  headers?: Record<string, string>;
}

/**
 * Failure codes are short machine strings that land in mail_log.error_code
 * (`^[a-z_]{1,40}$`). Never a provider message: those can echo the address.
 */
export type MailFailureCode =
  | 'rate_limited'
  | 'daily_quota_exceeded'
  | 'monthly_quota_exceeded'
  | 'provider_rejected'
  | 'provider_unavailable'
  | 'timeout'
  | 'network';

export type SendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; errorCode: MailFailureCode };

export interface MailProvider {
  send(mail: OutgoingMail): Promise<SendResult>;
  /**
   * Up to MAIL_BATCH_MAX mails in one provider call (guest mail). One result
   * per mail, in order. A batch the provider refuses as a whole fails every
   * mail in it with the same code.
   */
  sendBatch(mails: OutgoingMail[], idempotencyKey: string): Promise<SendResult[]>;
}

/** Resend's batch limit. */
export const MAIL_BATCH_MAX = 100;

/**
 * The local stack's mail catcher (Mailpit, where the Supabase CLI puts its own
 * auth mail), or null. The same gate as the dev-login route (onLocalDevStack:
 * never a production build, only a localhost Supabase URL). INBUCKET_URL
 * overrides the fixed port.
 */
export function localMailCatcher(): string | null {
  if (!onLocalDevStack()) return null;
  return process.env.INBUCKET_URL || 'http://127.0.0.1:55324';
}

/** `PlusOne <support@plus-one.io>` -> `support@plus-one.io`. */
function senderAddress(from: string): string {
  return /<([^>]+)>/.exec(from)?.[1] ?? from;
}

/** `"Neon Friday via PlusOne" <x@y>` -> `Neon Friday via PlusOne`. */
function senderDisplay(from: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*</.exec(from);
  return m?.[1]?.trim() || 'PlusOne';
}

// Keyless fallback: local dev and CI. Logs type + idempotency key only. On the
// local stack the mail also lands in Mailpit: fire and forget, so a missing
// catcher never fails or slows the send, and its error is never logged.
export class StubMailProvider implements MailProvider {
  async send(mail: OutgoingMail): Promise<SendResult> {
    console.info('[mail:stub] not sent (no Resend key configured)', {
      type: mail.type,
      key: mail.idempotencyKey,
    });
    const catcher = localMailCatcher();
    if (catcher) {
      void fetch(`${catcher}/api/v1/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          From: {
            Email: mail.from ? senderAddress(mail.from) : 'noreply@plus-one.io',
            Name: mail.from ? senderDisplay(mail.from) : 'PlusOne',
          },
          To: [{ Email: mail.to }],
          ...(mail.replyTo ? { ReplyTo: [{ Email: mail.replyTo }] } : {}),
          ...(mail.headers ? { Headers: mail.headers } : {}),
          Subject: mail.subject,
          Text: mail.text,
          HTML: mail.html,
          Tags: [mail.type],
        }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => undefined);
    }
    return { ok: true, providerMessageId: null };
  }

  async sendBatch(mails: OutgoingMail[]): Promise<SendResult[]> {
    const results: SendResult[] = [];
    for (const mail of mails) results.push(await this.send(mail));
    return results;
  }
}

// The single provider instance the app reads from.
export const mailProvider: MailProvider = mailConfig.resendEnabled && mailConfig.apiKey
  ? new ResendAdapter(mailConfig.apiKey)
  : new StubMailProvider();
