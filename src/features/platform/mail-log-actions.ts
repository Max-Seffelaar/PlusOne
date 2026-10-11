'use server';

// Platform mail log actions (ClickUp z8uq9m49k1, decisions Max 2026-10-11
// #4/#5). Both go through the caller's own session: the RPCs check
// is_platform_admin() themselves (42501 otherwise).
//
//   revealMailRecipient  the full address of one mail, for a support ticket;
//                        platform_reveal_mail_recipient writes the
//                        platform_access_log row (CLAUDE.md decision 8).
//   sendPlatformTestMail one template with made-up data to a current platform
//                        admin's sign-in address (picked by user id; the
//                        address comes from platform_test_mail_recipients,
//                        and log_platform_test_mail refuses any other):
//                        its own limit, marked as a test, the real provider,
//                        the result on the row through the service client
//                        (mail_log grants no write to app roles; the
//                        documented exception).

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthContext } from '@/lib/auth/context';
import { invalidInput, unauthorized, type MutationError } from '@/lib/db-errors';
import { mailProvider } from '@/features/mail/provider';
import { teamMailActive } from '@/features/mail/config';
import { appUrl, recipientHash } from '@/features/mail/send';
import { buildTestMail, isTestMailType } from '@/features/mail/test-mails';
import { t } from '@/lib/i18n';

const revealSchema = z
  .object({
    mailLogId: z.string().uuid(),
    ticket: z.string().trim().min(3).max(200),
  })
  .strict();

export type RevealResult = { ok: true; address: string | null } | MutationError;

export async function revealMailRecipient(input: z.input<typeof revealSchema>): Promise<RevealResult> {
  const parsed = revealSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('platform_reveal_mail_recipient', {
    p_mail_log_id: parsed.data.mailLogId,
    p_ticket: parsed.data.ticket,
  });
  if (error) {
    if (error.code === '42501') return unauthorized();
    if (error.code === '22023') return invalidInput();
    console.error('revealMailRecipient failed', { code: error.code });
    return { ok: false, code: 'error', message: t.platform.mailLogRevealError };
  }
  return { ok: true, address: typeof data === 'string' ? data : null };
}

const testSchema = z
  .object({
    type: z.string().refine(isTestMailType),
    toUserId: z.string().uuid(),
  })
  .strict();

export type TestMailResult = { ok: true } | MutationError;

export async function sendPlatformTestMail(input: z.input<typeof testSchema>): Promise<TestMailResult> {
  const p = t.platform;
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) return invalidInput(p.testMailInvalidTo);
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  if (!teamMailActive()) return { ok: false, code: 'not_configured', message: p.testMailError };

  const { type, toUserId } = parsed.data;
  const supabase = await createClient();
  // Only a current platform admin's sign-in address (review #463); the RPC
  // refuses anyone else too, this only turns the id into the address.
  const { data: recipients, error: listError } = await supabase.rpc('platform_test_mail_recipients');
  if (listError) {
    if (listError.code === '42501') return unauthorized();
    return { ok: false, code: 'error', message: p.testMailError };
  }
  const to = (recipients ?? []).find((r) => r.user_id === toUserId)?.email;
  if (!to) return invalidInput(p.testMailInvalidTo);

  const { data: logId, error } = await supabase.rpc('log_platform_test_mail', {
    p_type: type,
    p_recipient_hash: recipientHash(to),
  });
  if (error || typeof logId !== 'string') {
    if (error?.code === '42501') return unauthorized();
    if (error?.code === 'PM429') return { ok: false, code: 'PM429', message: p.testMailLimit };
    console.error('sendPlatformTestMail: log failed', { code: error?.code });
    return { ok: false, code: 'error', message: p.testMailError };
  }

  const result = await mailProvider.send(buildTestMail(type, to, appUrl(), logId));
  const { error: recordError } = await createServiceClient().rpc('record_mail_send_result', {
    p_id: logId,
    p_status: result.ok ? 'sent' : 'failed',
    p_provider_message_id: result.ok ? (result.providerMessageId ?? undefined) : undefined,
    p_error_code: result.ok ? undefined : result.errorCode,
  });
  if (recordError) console.error('sendPlatformTestMail: record failed', { code: recordError.code });
  return result.ok ? { ok: true } : { ok: false, code: 'send_failed', message: p.testMailError };
}
