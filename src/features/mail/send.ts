import 'server-only';

// Team mail sender (Mail-infra F0, z8uq9m2yvt). BEST EFFORT by contract: it
// never throws, and a failure is only ever `{ ok: false }` for the caller to
// weigh (an initial invite carries on, a resend reports it). It is never on
// the door path: nothing under src/features/door imports it.
//
// Order per mail: log_mail_attempt (service_role RPC, row = queued) → provider
// send with Idempotency-Key = the row id → record_mail_send_result. A 429 from
// Resend (rate limit, daily/monthly quota) is one `failed` row and stops
// there: no retry loop, so a quota outage can't turn into a retry storm that
// also eats the login-OTP quota on the same Resend account.
//
// The service client is the documented exception here: mail_log grants no
// write to any app role (20261007130000), and the callers already authorized
// the actor (invite RLS / admin check) before reaching this.

import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { teamMailActive } from './config';
import { mailProvider } from './provider';
import { renderTeamMail, type InviteLink, type TeamMailContent } from './templates';

export type TeamMail = TeamMailContent & { to: string };

/**
 * Where the mail's button points (one invite mail, z8uq9m2yvp). Resolved only
 * once the send is logged, i.e. the recipient window and the company cap
 * passed, so a refused send never mints a sign-in token (which would also void
 * the one in the mail that went out a minute ago). `login` = the bare /login
 * page (an account that can already log in); `invite` = a one-time sign-in
 * link for a new or never-confirmed address: a bearer credential that goes
 * into the mail body and nowhere else (no log, no mail_log, no error message);
 * `unavailable` = the address could not be provisioned, nothing is sent.
 */
export type TeamMailCta = { kind: 'login' } | { kind: 'invite'; link: InviteLink } | { kind: 'unavailable' };

export interface TeamMailOptions {
  cta?: () => Promise<TeamMailCta>;
}

/** `recipient_window`: a mail went to this address within mail_recipient_window()
 *  (60 s); `venue_cap`: the company's daily invitation cap. Both are PM429 from
 *  log_mail_attempt, told apart by its message, so callers can say which. */
export type TeamMailResult =
  | { ok: true }
  | { ok: false; reason: 'inactive' | 'failed' | 'recipient_window' | 'venue_cap' | 'cta_unavailable' };

/** sha256 of the trimmed, lowercased address: what mail_log stores instead of it. */
export function recipientHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://app.plus-one.io';
}

export async function sendTeamMail(mail: TeamMail, options: TeamMailOptions = {}): Promise<TeamMailResult> {
  if (!teamMailActive()) return { ok: false, reason: 'inactive' };

  try {
    const service = createServiceClient();

    const { data: logId, error: logError } = await service.rpc('log_mail_attempt', {
      p_type: mail.template,
      // The decline mails carry no venue (null): the invitee caused them, so they
      // stay out of the company's daily cap. The column is nullable; the
      // generated RPC arg type just doesn't say so.
      p_venue_id: mail.venueId as string,
      p_recipient_hash: recipientHash(mail.to),
    });
    if (logError || !logId) {
      // PM429 = the send limits in log_mail_attempt (per recipient / per venue
      // per day): expected under abuse or a double click, so a warning.
      if (logError?.code === 'PM429') {
        console.warn('sendTeamMail: throttled', { type: mail.template });
        if (/recipient/i.test(logError.message ?? '')) return { ok: false, reason: 'recipient_window' };
        if (/venue/i.test(logError.message ?? '')) return { ok: false, reason: 'venue_cap' };
        return { ok: false, reason: 'failed' };
      }
      console.error('sendTeamMail: log_mail_attempt failed', { code: logError?.code, type: mail.template });
      return { ok: false, reason: 'failed' };
    }

    const cta: TeamMailCta = options.cta ? await options.cta() : { kind: 'login' };
    if (cta.kind === 'unavailable') {
      await settle(service, logId, { ok: false, errorCode: 'provision_failed' });
      return { ok: false, reason: 'cta_unavailable' };
    }
    const rendered = renderTeamMail(mail, appUrl(), cta.kind === 'invite' ? cta.link : undefined);

    const result = await mailProvider.send({
      to: mail.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `mail_log/${logId}`,
      type: mail.template,
    });

    await settle(service, logId, result);
    return result.ok ? { ok: true } : { ok: false, reason: 'failed' };
  } catch (err) {
    console.error('sendTeamMail: unexpected error', {
      type: mail.template,
      error: err instanceof Error ? err.name : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

async function settle(
  service: ReturnType<typeof createServiceClient>,
  logId: string,
  result: { ok: true; providerMessageId: string | null } | { ok: false; errorCode: string },
): Promise<void> {
  const { error } = await service.rpc('record_mail_send_result', {
    p_id: logId,
    p_status: result.ok ? 'sent' : 'failed',
    p_provider_message_id: result.ok ? (result.providerMessageId ?? undefined) : undefined,
    p_error_code: result.ok ? undefined : result.errorCode,
  });
  // The mail itself went (or didn't) regardless; only the bookkeeping lags.
  if (error) console.error('sendTeamMail: record_mail_send_result failed', { code: error.code, logId });
}
