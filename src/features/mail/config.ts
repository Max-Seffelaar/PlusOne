import 'server-only';

import { onLocalDevStack } from '@/lib/local-stack';

// Mail configuration (Mail-infra F0, z8uq9m2yvt). The app sends its own mail
// (team invites now; billing and guest mail later) through Resend's HTTP API
// with a SEPARATE key from the SMTP key Supabase Auth uses for login mail
// (docs/mail-deliverability.md, "two keys, each in its own place"). Both
// values are server-only and are read nowhere else (secret-grep guard in
// src/lib/supabase/service-confinement.test.ts). Missing RESEND_API_KEY =
// the stub provider; missing RESEND_WEBHOOK_SECRET = the webhook refuses
// every delivery.

export interface MailConfig {
  /** True only with RESEND_API_KEY set: real mail leaves the building. */
  resendEnabled: boolean;
  apiKey: string | null;
  webhookSecret: string | null;
}

function readConfig(): MailConfig {
  const apiKey = process.env.RESEND_API_KEY || null;
  return {
    resendEnabled: Boolean(apiKey),
    apiKey,
    webhookSecret: process.env.RESEND_WEBHOOK_SECRET || null,
  };
}

export const mailConfig: MailConfig = readConfig();

/** Every app mail goes out as this sender (the apex, verified in Resend). */
export const MAIL_FROM = 'PlusOne <noreply@plus-one.io>';

/**
 * Whether team mail (the Resend templates) replaces the magic-link fallback
 * for an existing account. True with a Resend key. Without one it is true only
 * outside a production build, where the stub logs the send (no address) so the
 * new path is exercisable locally and in CI. A production build without the key,
 * which is prod until Max sets it, keeps today's magic-link behaviour, so prod
 * never regresses to "no mail at all". Vercel previews build with
 * NODE_ENV=production too and behave like prod.
 */
export function teamMailActive(): boolean {
  return mailConfig.resendEnabled || process.env.NODE_ENV !== 'production';
}

/** The verified sending domain (Resend). Guest mail goes out as noreply+<key>@ it. */
export const MAIL_DOMAIN = 'plus-one.io';

/**
 * Whether guest mail (src/features/mail/guest-job.ts) is queued and sent.
 * True with a Resend key; without one only on the local stack, where the stub
 * hands every mail to Mailpit. Like billing mail there is no "stub in
 * CI/preview/prod" case: the job writes mail_log rows that say "sent", and a
 * prod build without the key must not pile up a queue that a later key would
 * flush as stale mail.
 */
export function guestMailActive(): boolean {
  return mailConfig.resendEnabled || onLocalDevStack();
}
