import 'server-only';

// Team notification mail job (Gastcommunicatie F, PR 6b, z8uq9m2vpy). Drains
// the email rows of notification_outbox and the daily summary:
//   1. claim: team_mails_claim (in-process) or team_mails_begin(token) (the
//      cron route) merges a bundle slot into one mail per recipient, re-checks
//      preference, access and the request at send time, writes mail_log and
//      mints the unsubscribe link. The mail says only what that payload says.
//   2. render: renderTeamNotify (pure).
//   3. send: the provider's batch call, 100 per call, the batch key from the
//      mail_log ids.
//   4. settle: team_mails_settle (a refusal the provider answered retries; a
//      timeout or network error never does: never mailed twice).
// Entry points, server-only: runTeamMailsRoute (the cron route, a single-use
// token from pg_net) and drainTeamMails (after() of the actions that file or
// decide a request). Never imported by the door (mail-confinement.test.ts).
//
// The service client is the documented exception (CLAUDE.md; the guest- and
// billing-mail precedent): the outbox, mail_log, the links and the
// preferences grant no app role anything, and the cron path has no session.
// Never logged: addresses, names, tokens, provider messages.

import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { guestMailActive } from './config';
import { MAIL_BATCH_MAX, mailProvider, type OutgoingMail, type SendResult } from './provider';
import { appUrl } from './send';
import { renderTeamNotify, type TeamDigestCompany, type TeamNotifyType } from './templates/team-notify';

export interface RpcResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

export interface TeamMailDeps {
  rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  sendBatch(mails: OutgoingMail[], idempotencyKey: string): Promise<SendResult[]>;
  /** False = no real mail can leave: nothing is claimed. */
  active: boolean;
  appUrl: string;
  pause?: () => Promise<void>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export interface TeamMailTotals {
  claimed: number;
  sent: number;
  failed: number;
}

export type TeamMailRunResult =
  | { status: 200; totals: TeamMailTotals }
  | { status: 401 | 502 | 503; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const LINK_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^@\s<>",;:]+@[^@\s<>",;:]+\.[^@\s<>",;:]+$/;
const TYPES: readonly TeamNotifyType[] = ['team_request', 'team_quota', 'team_decision', 'team_digest'];

export interface ClaimedTeamMail {
  mailLogId: string;
  queueIds: string[];
  type: TeamNotifyType;
  to: string;
  firstName: string | null;
  linkToken: string;
  company: string;
  event: { id: string; name: string; startsAt: string } | null;
  count: number;
  request: { firstName: string | null; plusOnes: number } | null;
  quota: { requester: string; extra: number } | null;
  decision: { status: 'approved' | 'denied'; extra: number } | null;
  digest: TeamDigestCompany[] | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** One claim payload entry -> a typed mail, or null when anything is off. */
export function parseTeamMail(raw: unknown): ClaimedTeamMail | null {
  const m = obj(raw);
  if (!m) return null;
  const mailLogId = str(m.mail_log_id);
  const type = str(m.type) as TeamNotifyType | null;
  const to = str(m.to);
  const link = obj(m.link);
  const token = str(link?.token);
  const queueIds = Array.isArray(m.queue_ids) ? m.queue_ids.filter((x): x is string => typeof x === 'string') : [];
  if (!mailLogId || !UUID.test(mailLogId) || !type || !TYPES.includes(type)) return null;
  if (!to || !EMAIL.test(to) || !token || !LINK_TOKEN.test(token)) return null;
  if (!queueIds.every((id) => UUID.test(id))) return null;

  const ev = obj(m.event);
  const event =
    ev && str(ev.id) && str(ev.name) && str(ev.starts_at)
      ? { id: str(ev.id) as string, name: str(ev.name) as string, startsAt: str(ev.starts_at) as string }
      : null;
  if (type !== 'team_digest' && !event) return null;

  const r = obj(m.request);
  const q = obj(m.quota);
  const d = obj(m.decision);
  const status = str(d?.status);
  const digestRaw = Array.isArray(m.digest) ? m.digest : null;
  const digest: TeamDigestCompany[] | null = digestRaw
    ? digestRaw.flatMap((c) => {
        const co = obj(c);
        if (!co || !str(co.name) || !Array.isArray(co.events)) return [];
        return [
          {
            name: str(co.name) as string,
            events: co.events.flatMap((e) => {
              const eo = obj(e);
              if (!eo || !str(eo.name) || !str(eo.starts_at)) return [];
              return [{ name: str(eo.name) as string, startsAt: str(eo.starts_at) as string, requests: num(eo.requests), quota: num(eo.quota) }];
            }),
          },
        ];
      })
    : null;
  if (type === 'team_digest' && (!digest || digest.length === 0)) return null;

  return {
    mailLogId,
    queueIds,
    type,
    to,
    firstName: str(m.first_name),
    linkToken: token,
    company: str(obj(m.company)?.name) ?? '',
    event,
    count: Math.max(1, num(m.count) || 1),
    request: r ? { firstName: str(r.first_name), plusOnes: num(r.plus_ones) } : null,
    quota: q && str(q.requester) ? { requester: str(q.requester) as string, extra: num(q.extra) } : null,
    decision: d && (status === 'approved' || status === 'denied') ? { status, extra: num(d.extra) } : null,
    digest,
  };
}

/** The provider mail for one claimed entry. */
export function buildTeamMail(mail: ClaimedTeamMail, baseUrl: string): OutgoingMail {
  const base = baseUrl.replace(/\/$/, '');
  const unsubscribeUrl = `${base}/n/${mail.linkToken}`;
  const rendered = renderTeamNotify({
    type: mail.type,
    firstName: mail.firstName,
    company: mail.company,
    event: mail.event,
    count: mail.count,
    request: mail.request,
    quota: mail.quota,
    decision: mail.decision,
    digest: mail.digest,
    appUrl: base,
    unsubscribeUrl,
  });
  return {
    to: mail.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: `mail_log/${mail.mailLogId}`,
    type: mail.type,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

function batchKey(mails: ClaimedTeamMail[]): string {
  const ids = mails.map((m) => m.mailLogId).sort().join(',');
  return `team_batch/${createHash('sha256').update(ids).digest('hex').slice(0, 48)}`;
}

async function deliver(raw: unknown, deps: TeamMailDeps, totals: TeamMailTotals): Promise<void> {
  const log = deps.log ?? (() => undefined);
  const list = Array.isArray(obj(raw)?.mails) ? (obj(raw)?.mails as unknown[]) : [];
  const good: ClaimedTeamMail[] = [];
  const settleRows: Array<Record<string, unknown>> = [];
  for (const item of list) {
    totals.claimed += 1;
    const parsed = parseTeamMail(item);
    if (parsed) {
      good.push(parsed);
      continue;
    }
    // Settle what can be settled, so nothing stays 'sending'.
    const m = obj(item);
    const logId = str(m?.mail_log_id);
    const ids = Array.isArray(m?.queue_ids) ? (m?.queue_ids as unknown[]).filter((x) => typeof x === 'string' && UUID.test(x)) : [];
    settleRows.push({
      mail_log_id: logId && UUID.test(logId) ? logId : null,
      queue_ids: ids,
      ok: false,
      error_code: 'malformed',
    });
    totals.failed += 1;
    log('malformed_mail');
  }

  for (let i = 0; i < good.length; i += MAIL_BATCH_MAX) {
    const chunk = good.slice(i, i + MAIL_BATCH_MAX);
    let results: SendResult[];
    try {
      results = await deps.sendBatch(chunk.map((m) => buildTeamMail(m, deps.appUrl)), batchKey(chunk));
    } catch {
      results = chunk.map(() => ({ ok: false, errorCode: 'network' as const }));
    }
    chunk.forEach((m, j) => {
      const res = results[j] ?? { ok: false, errorCode: 'provider_unavailable' as const };
      if (res.ok) totals.sent += 1;
      else totals.failed += 1;
      settleRows.push(
        res.ok
          ? { mail_log_id: m.mailLogId, queue_ids: m.queueIds, ok: true, provider_message_id: res.providerMessageId }
          : { mail_log_id: m.mailLogId, queue_ids: m.queueIds, ok: false, error_code: res.errorCode },
      );
    });
    if (deps.pause && i + MAIL_BATCH_MAX < good.length) await deps.pause();
  }

  if (settleRows.length > 0) {
    const settled = await deps.rpc('team_mails_settle', { p_results: settleRows });
    // A row left 'sending' is failed as unknown_outcome by a later claim.
    if (settled.error) log('settle_failed', { code: settled.error.code ?? null });
  }
}

/** The cron route: authenticate (consume the token) before anything is read. */
export async function runTeamMailsRoute(token: string | null, deps: TeamMailDeps): Promise<TeamMailRunResult> {
  const log = deps.log ?? (() => undefined);
  if (!token || !TOKEN.test(token)) return { status: 401, error: 'invalid_token' };
  const begun = await deps.rpc('team_mails_begin', { p_token: token, p_limit: deps.active ? 400 : 0 });
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
  const totals: TeamMailTotals = { claimed: 0, sent: 0, failed: 0 };
  await deliver(begun.data, deps, totals);
  log('done', totals as unknown as Record<string, unknown>);
  return { status: 200, totals };
}

/** In-process drain (after() of an action that filed or decided a request). Never throws. */
export async function drainTeamMails(deps: TeamMailDeps, limit = 200): Promise<TeamMailTotals> {
  const totals: TeamMailTotals = { claimed: 0, sent: 0, failed: 0 };
  if (!deps.active) return totals;
  try {
    const claimed = await deps.rpc('team_mails_claim', { p_limit: limit });
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
export function defaultTeamMailDeps(): TeamMailDeps {
  const service = createServiceClient();
  return {
    rpc: async (fn, args) => {
      const { data, error } = await (
        service.rpc.bind(service) as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>
      )(fn, args);
      return { data, error };
    },
    sendBatch: (mails, key) => mailProvider.sendBatch(mails, key),
    // Same gate as guest mail: a Resend key, or the local stack (Mailpit).
    active: guestMailActive(),
    appUrl: appUrl(),
    pause: () => new Promise((resolve) => setTimeout(resolve, 600)),
    log: (event, fields) => console.info(JSON.stringify({ job: 'team-mails', event, ...fields })),
  };
}
