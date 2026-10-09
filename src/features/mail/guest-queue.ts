import 'server-only';

// Guest-mail hooks for the server actions (Gastcommunicatie F, z8uq9m2vpy).
//
// An action calls one of these AFTER its own user-scoped mutation succeeded:
// that mutation, under RLS, is the authorization (the sendTeamMail stance).
// The enqueue RPCs are service_role only and derive venue, event, address and
// eligibility from the database: an action names a guest or an event, never
// a recipient. Everything runs in after(): the response has already gone, so
// the user never waits on the queue or the mail provider, and a failure here
// is logged (codes only) and never turns a saved change into an error.
//
// The door never calls this (src/features/door may not import the mail
// module, mail-confinement.test.ts): a guest added at the door gets no mail.

import { after } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { guestMailActive } from './config';
import { defaultGuestMailDeps, drainGuestMails } from './guest-job';

export type GuestMailOne =
  | { type: 'guest_on_list'; guestId: string }
  | { type: 'guest_plus_ones'; guestId: string }
  | { type: 'guest_removed'; guestId: string; remark: string }
  | { type: 'guest_request_approved'; guestId: string; requestId: string; remark?: string | null }
  | { type: 'guest_request_partly'; guestId: string; requestId: string; remark?: string | null };

export type GuestMailEvent = {
  type: 'guest_event_changed' | 'guest_event_canceled' | 'guest_reminder';
  eventId: string;
  remark?: string | null;
};

/** +N edits and event edits wait this long, so a burst of edits sends one mail. */
export const DEBOUNCE_SECONDS: Partial<Record<string, number>> = {
  guest_plus_ones: 60,
  guest_event_changed: 120,
};

/** Bulk enqueues run this many RPCs at a time. */
const PARALLEL = 10;

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.warn(JSON.stringify({ job: 'guest-mails', event, ...fields }));
}

type Service = ReturnType<typeof createServiceClient>;
type UntypedRpc = (fn: string, args: Record<string, unknown>) => Promise<{ error: { code?: string } | null }>;

async function enqueueOne(service: Service, mail: GuestMailOne, actorId: string | null): Promise<void> {
  const rpc = service.rpc.bind(service) as unknown as UntypedRpc;
  const { error } = await rpc('enqueue_guest_mail', {
    p_guest_id: mail.guestId,
    p_type: mail.type,
    p_remark: 'remark' in mail ? (mail.remark ?? null) : null,
    p_actor: actorId,
    p_delay_seconds: DEBOUNCE_SECONDS[mail.type] ?? 0,
    p_request_id: 'requestId' in mail ? mail.requestId : null,
  });
  if (error) log('enqueue_failed', { type: mail.type, code: error.code ?? null });
}

async function enqueueEvent(service: Service, mail: GuestMailEvent, actorId: string | null): Promise<void> {
  const rpc = service.rpc.bind(service) as unknown as UntypedRpc;
  const { error } = await rpc('enqueue_event_mail', {
    p_event_id: mail.eventId,
    p_type: mail.type,
    p_remark: mail.remark ?? null,
    p_actor: actorId,
    p_delay_seconds: DEBOUNCE_SECONDS[mail.type] ?? 0,
  });
  if (error) log('enqueue_failed', { type: mail.type, code: error.code ?? null });
}

/**
 * Queue per-guest mails and drain what is due, after the response. A no-op
 * where guest mail is not active (a prod build without a Resend key).
 */
export function queueGuestMails(mails: GuestMailOne[], actorId: string | null): void {
  if (mails.length === 0 || !guestMailActive()) return;
  after(async () => {
    try {
      const service = createServiceClient();
      for (let i = 0; i < mails.length; i += PARALLEL) {
        await Promise.all(mails.slice(i, i + PARALLEL).map((m) => enqueueOne(service, m, actorId)));
      }
      await drainGuestMails(defaultGuestMailDeps());
    } catch (err) {
      log('queue_failed', { error: err instanceof Error ? err.name : 'unknown' });
    }
  });
}

/** Queue an event-wide mail (details changed, canceled, reminder) and drain, after the response. */
export function queueEventMail(mail: GuestMailEvent, actorId: string | null): void {
  if (!guestMailActive()) return;
  after(async () => {
    try {
      await enqueueEvent(createServiceClient(), mail, actorId);
      await drainGuestMails(defaultGuestMailDeps());
    } catch (err) {
      log('queue_failed', { error: err instanceof Error ? err.name : 'unknown' });
    }
  });
}

/**
 * The decline mail for a whole request (task 7 wires it into its decision
 * action; the note is mandatory). Exported now so E only has to call it.
 */
export function queueRequestDeclinedMail(requestId: string, remark: string, actorId: string | null): void {
  if (!guestMailActive()) return;
  after(async () => {
    try {
      const service = createServiceClient();
      const rpc = service.rpc.bind(service) as unknown as UntypedRpc;
      const { error } = await rpc('enqueue_request_declined_mail', {
        p_request_id: requestId,
        p_remark: remark,
        p_actor: actorId,
      });
      if (error) log('enqueue_failed', { type: 'guest_request_declined', code: error.code ?? null });
      await drainGuestMails(defaultGuestMailDeps());
    } catch (err) {
      log('queue_failed', { error: err instanceof Error ? err.name : 'unknown' });
    }
  });
}

/** Drain what is due, after the response (a company just added its contact address). */
export function drainQueuedGuestMails(): void {
  if (!guestMailActive()) return;
  after(async () => {
    await drainGuestMails(defaultGuestMailDeps());
  });
}
