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
import { renderTeamMail, type TeamMailContent } from './templates';

export type TeamMail = TeamMailContent & { to: string };

export type TeamMailResult = { ok: true } | { ok: false; reason: 'inactive' | 'failed' };

/** sha256 of the trimmed, lowercased address: what mail_log stores instead of it. */
export function recipientHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://app.plus-one.io';
}

export async function sendTeamMail(mail: TeamMail): Promise<TeamMailResult> {
  if (!teamMailActive()) return { ok: false, reason: 'inactive' };

  try {
    const rendered = renderTeamMail(mail, appUrl());
    const service = createServiceClient();

    const { data: logId, error: logError } = await service.rpc('log_mail_attempt', {
      p_type: mail.template,
      p_venue_id: mail.venueId,
      p_recipient_hash: recipientHash(mail.to),
    });
    if (logError || !logId) {
      // PM429 = the send limits in log_mail_attempt (per recipient / per venue
      // per day): expected under abuse or a double click, so a warning.
      if (logError?.code === 'PM429') {
        console.warn('sendTeamMail: throttled', { type: mail.template });
        return { ok: false, reason: 'failed' };
      }
      console.error('sendTeamMail: log_mail_attempt failed', { code: logError?.code, type: mail.template });
      return { ok: false, reason: 'failed' };
    }

    const result = await mailProvider.send({
      to: mail.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `mail_log/${logId}`,
      type: mail.template,
    });

    const { error: settleError } = await service.rpc('record_mail_send_result', {
      p_id: logId,
      p_status: result.ok ? 'sent' : 'failed',
      p_provider_message_id: result.ok ? (result.providerMessageId ?? undefined) : undefined,
      p_error_code: result.ok ? undefined : result.errorCode,
    });
    if (settleError) {
      // The mail itself went (or didn't) regardless; only the bookkeeping lags.
      console.error('sendTeamMail: record_mail_send_result failed', { code: settleError.code, logId });
    }

    return result.ok ? { ok: true } : { ok: false, reason: 'failed' };
  } catch (err) {
    console.error('sendTeamMail: unexpected error', {
      type: mail.template,
      error: err instanceof Error ? err.name : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}
