import 'server-only';

// Mail abstraction (Mail-infra F0, z8uq9m2yvt), the billing pattern
// (src/features/billing/provider.ts): the app never calls Resend directly.
// Every send goes through a MailProvider, so swapping the provider touches only
// this directory (a vitest guard keeps `resend` and the API host in here).
// Without the Resend API key the stub serves local dev and tests: it logs the send
// WITHOUT the address and reports success with no provider id.

import { mailConfig } from './config';
import { ResendAdapter } from './resend-adapter';

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** mail_log row id: one key per row, so a retried send never mails twice. */
  idempotencyKey: string;
  /** Mail type, sent as a provider tag (ASCII, no PII). */
  type: string;
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
}

// Keyless fallback: local dev and CI. Logs type + idempotency key only.
export class StubMailProvider implements MailProvider {
  async send(mail: OutgoingMail): Promise<SendResult> {
    console.info('[mail:stub] not sent (no Resend key configured)', {
      type: mail.type,
      key: mail.idempotencyKey,
    });
    return { ok: true, providerMessageId: null };
  }
}

// The single provider instance the app reads from.
export const mailProvider: MailProvider = mailConfig.resendEnabled && mailConfig.apiKey
  ? new ResendAdapter(mailConfig.apiKey)
  : new StubMailProvider();
