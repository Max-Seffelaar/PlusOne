import 'server-only';

// Guest-mail job (Gastcommunicatie F, z8uq9m2vpy). Drains guest_mail_queue:
//   1. claim: guest_mails_claim (in-process) or guest_mails_begin(token) (the
//      cron route) picks the due rows FOR UPDATE SKIP LOCKED, re-checks each
//      against the database (spot, opt-out, canceled event, budgets), writes
//      the mail_log row and mints the per-mail links. Everything the mail says
//      comes from that payload, read at send time.
//   2. render: renderGuestMail (pure) per mail.
//   3. send: the mail provider's batch call, 100 mails per call (Resend's
//      limit), the batch Idempotency-Key derived from the mail_log ids.
//   4. settle: guest_mails_settle (sent / failed; transient failures retry,
//      at most three attempts in total).
// Two entry points, both server-only: runGuestMailsRoute (the cron route, a
// single-use token from pg_net) and drainGuestMails (called in after() by the
// actions that queued a mail: outside the request path, the response has
// already gone). Never imported by the door (mail-confinement.test.ts).
//
// The service client is the documented exception (CLAUDE.md; the
// billing-mail and stripe-webhook precedent): the queue, mail_log and the
// links grant no app role anything, and the cron path has no user session.
// Never logged: addresses, names, notes, tokens, provider messages.

import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { guestMailActive, MAIL_DOMAIN } from './config';
import { locationLine, renderGuestMail } from './templates/guest-mails';
import { GUEST_MAIL_TYPES, type GuestMailType } from './templates/guest-copy';
import { MAIL_BATCH_MAX, mailProvider, type OutgoingMail, type SendResult } from './provider';
import { appUrl } from './send';

export interface RpcResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

export interface GuestMailDeps {
  rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  sendBatch(mails: OutgoingMail[], idempotencyKey: string): Promise<SendResult[]>;
  /** False = no real mail can leave: nothing is claimed. */
  active: boolean;
  appUrl: string;
  /** Pause between provider calls (Resend: 2 requests/second by default). */
  pause?: () => Promise<void>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export interface GuestMailTotals {
  claimed: number;
  sent: number;
  failed: number;
}

export type GuestMailRunResult =
  | { status: 200; totals: GuestMailTotals }
  | { status: 401 | 502 | 503; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const LINK_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const REPLY_KEY = /^[0-9a-f]{40}$/;
const EMAIL = /^[^@\s<>",;:]+@[^@\s<>",;:]+\.[^@\s<>",;:]+$/;

export interface ClaimedMail {
  queueId: string;
  mailLogId: string;
  type: GuestMailType;
  to: string;
  firstName: string | null;
  remark: string | null;
  event: {
    id: string;
    name: string;
    startsAt: string;
    endsAt: string | null;
    location: string | null;
    houseRules: string | null;
    updatedAt: string | null;
  };
  company: { name: string; contactEmail: string };
  spot: { plusOnes: number; tierName: string; priceCents: number | null } | null;
  plusOnes: number;
  askedPeople: number | null;
  links: { status: string | null; unsubscribe: string; reply: string };
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const isDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(new Date(v).getTime());

/** One claimed mail, checked. Null = malformed: settled as failed, never mailed. */
export function parseClaimedMail(raw: unknown): ClaimedMail | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ev = (r.event ?? {}) as Record<string, unknown>;
  const co = (r.company ?? {}) as Record<string, unknown>;
  const ln = (r.links ?? {}) as Record<string, unknown>;
  const queueId = str(r.queue_id);
  const mailLogId = str(r.mail_log_id);
  const type = str(r.type);
  const to = str(r.to);
  if (!queueId || !UUID.test(queueId) || !mailLogId || !UUID.test(mailLogId)) return null;
  if (!type || !(GUEST_MAIL_TYPES as readonly string[]).includes(type)) return null;
  if (!to || !EMAIL.test(to)) return null;
  const eventId = str(ev.id);
  const eventName = str(ev.name);
  if (!eventId || !UUID.test(eventId) || !eventName || !isDate(ev.starts_at)) return null;
  const contactEmail = str(co.contact_email);
  const companyName = str(co.name);
  if (!companyName || !contactEmail || !EMAIL.test(contactEmail)) return null;
  const unsubscribe = str(ln.unsubscribe);
  const reply = str(ln.reply);
  const status = str(ln.status);
  if (!unsubscribe || !LINK_TOKEN.test(unsubscribe) || !reply || !REPLY_KEY.test(reply)) return null;
  if (status !== null && !LINK_TOKEN.test(status)) return null;

  let spot: ClaimedMail['spot'] = null;
  if (r.spot && typeof r.spot === 'object') {
    const sp = r.spot as Record<string, unknown>;
    const plusOnes = int(sp.plus_ones);
    const tierName = str(sp.tier_name);
    if (plusOnes === null || plusOnes < 0 || !tierName) return null;
    spot = { plusOnes, tierName, priceCents: int(sp.price_cents) };
  }

  return {
    queueId,
    mailLogId,
    type: type as GuestMailType,
    to,
    firstName: str(r.first_name),
    remark: str(r.remark),
    event: {
      id: eventId,
      name: eventName,
      startsAt: ev.starts_at as string,
      endsAt: isDate(ev.ends_at) ? ev.ends_at : null,
      location: locationLine(str(ev.location_name), str(ev.location_address)),
      houseRules: str(ev.house_rules),
      updatedAt: isDate(ev.updated_at) ? ev.updated_at : null,
    },
    company: { name: companyName, contactEmail },
    spot,
    plusOnes: spot?.plusOnes ?? Math.max(0, int(r.plus_ones) ?? 0),
    askedPeople: int(r.asked_people),
    links: { status, unsubscribe, reply },
  };
}

/** The outgoing mail for one claimed row: rendered body, per-mail sender, reply-to, one-click unsubscribe. */
export function buildGuestMail(mail: ClaimedMail, base: string): OutgoingMail {
  const root = base.replace(/\/+$/, '');
  const statusUrl = mail.links.status ? `${root}/s/${mail.links.status}` : null;
  const unsubscribeUrl = `${root}/u/${mail.links.unsubscribe}`;
  const rendered = renderGuestMail({
    type: mail.type,
    firstName: mail.firstName,
    event: mail.event,
    companyName: mail.company.name,
    contactEmail: mail.company.contactEmail,
    plusOnes: mail.plusOnes,
    tiers: mail.spot
      ? [{ name: mail.spot.tierName, people: mail.spot.plusOnes + 1, priceCents: mail.spot.priceCents }]
      : null,
    askedPeople: mail.askedPeople,
    remark: mail.remark,
    links: { statusUrl, icsUrl: statusUrl ? `${statusUrl}/calendar.ics` : null, unsubscribeUrl },
  });
  return {
    to: mail.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: `mail_log/${mail.mailLogId}`,
    type: mail.type,
    // The display name is sanitized in senderName (no quotes, no address syntax).
    from: `"${rendered.fromName}" <noreply+${mail.links.reply}@${MAIL_DOMAIN}>`,
    replyTo: mail.company.contactEmail,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

function batchKey(mails: ClaimedMail[]): string {
  const ids = mails.map((m) => m.mailLogId).sort().join(',');
  return `guest_batch/${createHash('sha256').update(ids).digest('hex').slice(0, 48)}`;
}

/** Render, send and settle one claim payload. */
async function deliver(raw: unknown, deps: GuestMailDeps, totals: GuestMailTotals): Promise<void> {
  const log = deps.log ?? (() => undefined);
  const list = raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).mails)
    ? ((raw as Record<string, unknown>).mails as unknown[])
    : [];
  const good: ClaimedMail[] = [];
  const settleRows: Array<Record<string, unknown>> = [];
  for (const item of list) {
    totals.claimed += 1;
    const parsed = parseClaimedMail(item);
    if (parsed) {
      good.push(parsed);
    } else {
      const queueId = item && typeof item === 'object' ? str((item as Record<string, unknown>).queue_id) : null;
      if (queueId && UUID.test(queueId)) settleRows.push({ queue_id: queueId, ok: false, error_code: 'malformed' });
      totals.failed += 1;
      log('malformed_mail');
    }
  }

  for (let i = 0; i < good.length; i += MAIL_BATCH_MAX) {
    const chunk = good.slice(i, i + MAIL_BATCH_MAX);
    let results: SendResult[];
    try {
      results = await deps.sendBatch(chunk.map((m) => buildGuestMail(m, deps.appUrl)), batchKey(chunk));
    } catch {
      results = chunk.map(() => ({ ok: false, errorCode: 'network' as const }));
    }
    chunk.forEach((m, j) => {
      const res = results[j] ?? { ok: false, errorCode: 'provider_unavailable' as const };
      if (res.ok) totals.sent += 1;
      else totals.failed += 1;
      settleRows.push(
        res.ok
          ? { queue_id: m.queueId, ok: true, provider_message_id: res.providerMessageId }
          : { queue_id: m.queueId, ok: false, error_code: res.errorCode },
      );
    });
    if (deps.pause && i + MAIL_BATCH_MAX < good.length) await deps.pause();
  }

  if (settleRows.length > 0) {
    const settled = await deps.rpc('guest_mails_settle', { p_results: settleRows });
    // A row left 'sending' is failed as unknown_outcome by a later claim:
    // never mailed twice.
    if (settled.error) log('settle_failed', { code: settled.error.code ?? null });
  }
}

/** The cron route: authenticate (consume the token) before anything is read. */
export async function runGuestMailsRoute(token: string | null, deps: GuestMailDeps): Promise<GuestMailRunResult> {
  const log = deps.log ?? (() => undefined);
  if (!token || !TOKEN.test(token)) return { status: 401, error: 'invalid_token' };
  // Only an authenticated caller learns that mail is not configured, and the
  // token is spent either way.
  const begun = await deps.rpc('guest_mails_begin', { p_token: token, p_limit: deps.active ? 400 : 0 });
  if (begun.error) {
    if (begun.error.code === '42501') {
      log('token_refused');
      return { status: 401, error: 'invalid_token' };
    }
    log('begin_failed', { code: begun.error.code ?? null });
    return { status: 502, error: 'rpc_failed' };
  }
  if (!deps.active) {
    log('mail_not_configured');
    return { status: 503, error: 'mail_not_configured' };
  }
  const totals: GuestMailTotals = { claimed: 0, sent: 0, failed: 0 };
  await deliver(begun.data, deps, totals);
  log('done', totals as unknown as Record<string, unknown>);
  return { status: 200, totals };
}

/** In-process drain (after() of an action that queued mail). Never throws. */
export async function drainGuestMails(deps: GuestMailDeps, limit = 200): Promise<GuestMailTotals> {
  const totals: GuestMailTotals = { claimed: 0, sent: 0, failed: 0 };
  if (!deps.active) return totals;
  try {
    const claimed = await deps.rpc('guest_mails_claim', { p_limit: limit });
    if (claimed.error) {
      deps.log?.('claim_failed', { code: claimed.error.code ?? null });
      return totals;
    }
    await deliver(claimed.data, deps, totals);
  } catch (err) {
    deps.log?.('drain_failed', { error: err instanceof Error ? err.name : 'unknown' });
  }
  return totals;
}

/** The production wiring: service client RPCs + the app's mail provider. */
export function defaultGuestMailDeps(): GuestMailDeps {
  const service = createServiceClient();
  return {
    rpc: async (fn, args) => {
      const { data, error } = await (
        service.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>
      )(fn, args);
      return { data, error };
    },
    sendBatch: (mails, key) => mailProvider.sendBatch(mails, key),
    active: guestMailActive(),
    appUrl: appUrl(),
    pause: () => new Promise((resolve) => setTimeout(resolve, 600)),
    log: (event, fields) => console.info(JSON.stringify({ job: 'guest-mails', event, ...fields })),
  };
}
