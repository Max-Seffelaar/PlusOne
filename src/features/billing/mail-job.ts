import 'server-only';

// Billing-mail job (Billing-mails B1, z8uq9m2z19). One run = one call of the
// route /api/webhooks/billing-mails, which pg_cron kicks hourly between 08:00
// and 20:59 Amsterdam through pg_net with a single-use token
// (billing_mails_tick in 20261013170000: the platform-digest pattern).
//
// What a run does, and nothing more:
//   1. authenticate: billing_mails_begin CONSUMES the token before anything
//      is read and raises 42501 for an unknown, expired or reused token. The
//      route holds no secret of its own; nothing from the request body is read.
//   2. trial mails: for each trialing company near a mail moment, ask the pure
//      schedule (dueBillingMails) which type is due right now.
//   3. Stripe mails: every queued payment-failed / canceled event of the last
//      three days (the Stripe webhook queues them, enqueue_billing_event_mail).
//   4. per mail, per recipient (admins + finance, resolved now):
//      log_billing_mail (NULL = this one already went: once per company per
//      trial type, once per Stripe event), send via the mail provider with
//      Idempotency-Key = the mail_log row, settle with record_mail_send_result.
//
// The service client is the documented exception (CLAUDE.md, the
// stripe-webhook precedent): mail_log and the billing-mail tables grant no app
// role anything, and there is no user session. Every write is a SECURITY
// DEFINER RPC that re-checks role, comped/paused and the key in the database.
//
// Never logged: addresses, names, the token, provider messages.

import { createServiceClient } from '@/lib/supabase/service';
import { billingMailActive } from '@/features/mail/config';
import { mailProvider, type OutgoingMail, type SendResult } from '@/features/mail/provider';
import {
  BILLING_MAIL_FROM,
  BILLING_MAIL_REPLY_TO,
  renderBillingMail,
} from '@/features/mail/templates/billing-mails';
import { dueBillingMails, EVENT_MAIL_TYPES, type BillingMailType, type EventMailType } from './mail-schedule';

export interface RpcResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

export interface BillingMailDeps {
  rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  send(mail: OutgoingMail): Promise<SendResult>;
  /** False = no real mail can leave (prod without a Resend key): the run stops after auth. */
  active: boolean;
  appUrl: string;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export interface BillingMailTotals {
  mails: number;
  sent: number;
  skipped: number;
  failed: number;
}

export type BillingMailRunResult =
  | { status: 200; totals: BillingMailTotals }
  | { status: 401 | 502 | 503; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;

interface TrialRow {
  venueId: string;
  createdAt: string;
  trialEndsAt: string;
  stripeLinked: boolean;
}

interface EventRow {
  stripeEventId: string;
  venueId: string;
  type: EventMailType;
}

interface Begin {
  now: Date;
  trials: TrialRow[];
  events: EventRow[];
}

interface Recipient {
  id: string;
  email: string;
  firstName: string | null;
}

/** The begin payload, checked: anything malformed is a server problem, never mailed. */
export function parseBegin(raw: unknown): Begin | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const now = typeof r.now === 'string' ? new Date(r.now) : null;
  if (!now || Number.isNaN(now.getTime()) || !Array.isArray(r.trials) || !Array.isArray(r.events)) return null;
  const isDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(new Date(v).getTime());

  const trials: TrialRow[] = [];
  for (const item of r.trials) {
    const t = (item ?? {}) as Record<string, unknown>;
    if (typeof t.venue_id !== 'string' || !UUID.test(t.venue_id)) return null;
    if (!isDate(t.created_at) || !isDate(t.trial_ends_at) || typeof t.stripe_linked !== 'boolean') return null;
    trials.push({
      venueId: t.venue_id,
      createdAt: t.created_at,
      trialEndsAt: t.trial_ends_at,
      stripeLinked: t.stripe_linked,
    });
  }

  const events: EventRow[] = [];
  for (const item of r.events) {
    const e = (item ?? {}) as Record<string, unknown>;
    if (typeof e.venue_id !== 'string' || !UUID.test(e.venue_id)) return null;
    if (typeof e.stripe_event_id !== 'string' || e.stripe_event_id.length === 0) return null;
    if (!(EVENT_MAIL_TYPES as readonly unknown[]).includes(e.type)) return null;
    events.push({ stripeEventId: e.stripe_event_id, venueId: e.venue_id, type: e.type as EventMailType });
  }
  return { now, trials, events };
}

function parseRecipients(raw: unknown): { company: string; recipients: Recipient[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.company !== 'string' || !Array.isArray(r.recipients)) return null;
  const recipients: Recipient[] = [];
  for (const item of r.recipients) {
    const p = (item ?? {}) as Record<string, unknown>;
    if (typeof p.id !== 'string' || !UUID.test(p.id) || typeof p.email !== 'string' || !p.email.includes('@')) {
      return null;
    }
    recipients.push({ id: p.id, email: p.email, firstName: typeof p.first_name === 'string' ? p.first_name : null });
  }
  return { company: r.company, recipients };
}

interface Delivery {
  venueId: string;
  type: BillingMailType;
  dedupeKey: string;
  trialEndsAt: string | null;
}

/** Send one mail to every current recipient of one company. */
async function deliver(deps: BillingMailDeps, d: Delivery, totals: BillingMailTotals, log: NonNullable<BillingMailDeps['log']>) {
  totals.mails += 1;
  const rec = await deps.rpc('billing_mail_recipients', { p_venue_id: d.venueId });
  const parsed = rec.error ? null : parseRecipients(rec.data);
  if (!parsed) {
    totals.failed += 1;
    log('recipients_failed', { type: d.type, code: rec.error?.code ?? null });
    return;
  }

  for (const recipient of parsed.recipients) {
    const logged = await deps.rpc('log_billing_mail', {
      p_venue_id: d.venueId,
      p_type: d.type,
      p_dedupe_key: d.dedupeKey,
      p_recipient_id: recipient.id,
    });
    if (logged.error) {
      // 42501/55000: no longer a recipient, paused, comped or not trialing
      // between begin and now. Anything else is a failed attempt with no row.
      if (logged.error.code === '42501' || logged.error.code === '55000') totals.skipped += 1;
      else totals.failed += 1;
      log('log_failed', { type: d.type, code: logged.error.code ?? null });
      continue;
    }
    const logId = typeof logged.data === 'string' ? logged.data : null;
    if (!logId) {
      totals.skipped += 1; // already sent under this key
      continue;
    }

    const rendered = renderBillingMail(
      { type: d.type, firstName: recipient.firstName, companyName: parsed.company, trialEndsAt: d.trialEndsAt },
      deps.appUrl
    );
    let result: SendResult;
    try {
      result = await deps.send({
        to: recipient.email,
        ...rendered,
        idempotencyKey: `mail_log/${logId}`,
        type: d.type,
        from: BILLING_MAIL_FROM,
        replyTo: BILLING_MAIL_REPLY_TO,
      });
    } catch {
      result = { ok: false, errorCode: 'network' };
    }
    if (result.ok) totals.sent += 1;
    else totals.failed += 1;

    const settled = await deps.rpc('record_mail_send_result', {
      p_id: logId,
      p_status: result.ok ? 'sent' : 'failed',
      p_provider_message_id: result.ok ? (result.providerMessageId ?? undefined) : undefined,
      p_error_code: result.ok ? undefined : result.errorCode,
    });
    // The mail went (or didn't) regardless; a row left 'queued' counts as
    // sent for the ledger, so no second mail goes out.
    if (settled.error) log('settle_failed', { code: settled.error.code ?? null });
  }
}

export async function runBillingMails(token: string | null, deps: BillingMailDeps): Promise<BillingMailRunResult> {
  const log =
    deps.log ?? ((event, fields) => console.info(JSON.stringify({ job: 'billing-mails', event, ...fields })));

  // Cheap pre-filter before any DB round trip. Tokens are 64 hex chars.
  if (!token || !TOKEN.test(token)) return { status: 401, error: 'invalid_token' };

  // 1. Authenticate (and consume) before anything else is observable.
  const begun = await deps.rpc('billing_mails_begin', { p_token: token });
  if (begun.error) {
    if (begun.error.code === '42501') {
      log('token_refused');
      return { status: 401, error: 'invalid_token' };
    }
    log('begin_failed', { code: begun.error.code ?? null });
    return { status: 502, error: 'rpc_failed' };
  }
  const begin = parseBegin(begun.data);
  if (!begin) {
    log('begin_malformed');
    return { status: 502, error: 'rpc_failed' };
  }

  // 2. Only an authenticated caller learns that mail is not configured. No
  //    mail_log row is written then, so nothing claims "sent".
  if (!deps.active) {
    log('mail_not_configured');
    return { status: 503, error: 'mail_not_configured' };
  }

  const totals: BillingMailTotals = { mails: 0, sent: 0, skipped: 0, failed: 0 };

  for (const trial of begin.trials) {
    const due = dueBillingMails(
      {
        status: 'trialing',
        createdAt: trial.createdAt,
        trialEndsAt: trial.trialEndsAt,
        stripeLinked: trial.stripeLinked,
        paused: false, // begin only returns companies that are not paused or comped
      },
      begin.now
    );
    for (const type of due) {
      await deliver(deps, { venueId: trial.venueId, type, dedupeKey: type, trialEndsAt: trial.trialEndsAt }, totals, log);
    }
  }

  for (const event of begin.events) {
    await deliver(
      deps,
      { venueId: event.venueId, type: event.type, dedupeKey: `stripe:${event.stripeEventId}`, trialEndsAt: null },
      totals,
      log
    );
  }

  log('done', totals as unknown as Record<string, unknown>);
  return { status: 200, totals };
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://app.plus-one.io';
}

/** The production wiring: service client RPCs + the app's mail provider. */
export function defaultBillingMailDeps(): BillingMailDeps {
  const service = createServiceClient();
  return {
    // The billing-mail RPCs are typed in database.types.ts; the job passes
    // them through one untyped seam so the core stays testable without it.
    rpc: async (fn, args) => {
      const { data, error } = await (
        service.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>
      )(fn, args);
      return { data, error };
    },
    send: (mail) => mailProvider.send(mail),
    active: billingMailActive(),
    appUrl: appUrl(),
  };
}
