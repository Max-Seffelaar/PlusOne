// platform-digest core (z8uq9m2ybj, decision §9 item 19): the daily numbers
// mail to the platform admins. Runtime-agnostic on purpose (fetch + JSON
// only), like push-dispatch/dispatch.ts: index.ts is the thin Deno entry and
// the unit suite (tests/unit/platform-digest.test.ts) drives handleDigest()
// with a mocked fetch, because CI does not run Deno tests.
//
// What this function does, and nothing more:
//   1. authenticate the caller with the single-use token pg_net sends
//      (x-platform-digest-token). platform_digest_begin CONSUMES it before
//      anything is read or decided, and raises 42501 for an unknown, expired
//      or reused token. This function holds no secret of its own.
//   2. take the aggregates and the recipients from that same call. Nothing
//      from the request body is ever read.
//   3. per recipient: log_platform_digest_mail (returns null when today's
//      digest to them is already queued/sent, so a repeated run mails nothing),
//      send through Resend with Idempotency-Key = the mail_log row, settle with
//      record_mail_send_result.
//
// MRR/ARR is deliberately absent: the only price source is
// BillingProvider.listPrices() in the Next app (src/features/billing), behind
// a user session. The mail points to the Overview screen instead.
//
// Never logged: recipient addresses, the caller's token, the service-role key,
// the Resend key, provider messages (only status codes and Resend's error
// `name`).

import { renderPlatformDigest, type DigestNumbers } from './template.ts';

export interface DigestEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Edge Function secret. Absent => no real mail (see mailTransport). */
  RESEND_API_KEY?: string;
  /** App origin for the Overview link (no hard-coded origin). Absent => no link. */
  APP_URL?: string;
  /** Local stack only: Mailpit's base URL. Ignored unless SUPABASE_URL is local. */
  PLATFORM_DIGEST_MAIL_CATCHER_URL?: string;
}

export interface DigestDeps {
  env: DigestEnv;
  fetch: typeof fetch;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export interface DigestRecipient {
  id: string;
  email: string;
}

export interface DigestBegin extends DigestNumbers {
  recipients: DigestRecipient[];
}

export type MailFailureCode =
  | 'rate_limited'
  | 'daily_quota_exceeded'
  | 'monthly_quota_exceeded'
  | 'provider_rejected'
  | 'provider_unavailable'
  | 'timeout'
  | 'network';

export type SendResult = { ok: true; providerMessageId: string | null } | { ok: false; errorCode: MailFailureCode };

export interface OutgoingDigest {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export type MailTransport =
  | { kind: 'resend'; apiKey: string }
  | { kind: 'catcher'; url: string }
  | { kind: 'none' };

/** Same sender as every app mail (src/features/mail/config.ts MAIL_FROM). */
export const DIGEST_FROM = 'PlusOne <noreply@plus-one.io>';
const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 8000;
const MAIL_TYPE = 'platform_digest';

/** True for the hosts a local Supabase stack's Edge Runtime sees as SUPABASE_URL. */
export function isLocalSupabaseUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === 'kong' ||
      host === 'host.docker.internal' ||
      host.startsWith('supabase_kong_')
    );
  } catch {
    return false;
  }
}

/**
 * Resend with a key. Without one, Mailpit only on a local stack (so a
 * developer sees the mail); anywhere else nothing, and the run reports
 * mail_not_configured instead of pretending it sent.
 */
export function mailTransport(env: DigestEnv): MailTransport {
  if (env.RESEND_API_KEY) return { kind: 'resend', apiKey: env.RESEND_API_KEY };
  if (env.PLATFORM_DIGEST_MAIL_CATCHER_URL && isLocalSupabaseUrl(env.SUPABASE_URL)) {
    return { kind: 'catcher', url: env.PLATFORM_DIGEST_MAIL_CATCHER_URL.replace(/\/+$/, '') };
  }
  return { kind: 'none' };
}

/** `${APP_URL}/app/platform/overview` for an https origin (or http on localhost), else null. */
export function overviewUrl(appUrl: string | undefined): string | null {
  if (!appUrl) return null;
  try {
    const u = new URL(appUrl);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
    return `${u.origin}/app/platform/overview`;
  } catch {
    return null;
  }
}

function failureFor429(name: unknown): MailFailureCode {
  if (name === 'daily_quota_exceeded') return 'daily_quota_exceeded';
  if (name === 'monthly_quota_exceeded') return 'monthly_quota_exceeded';
  return 'rate_limited';
}

export async function sendDigest(
  transport: Exclude<MailTransport, { kind: 'none' }>,
  mail: OutgoingDigest,
  fetchFn: typeof fetch,
  log: (event: string, fields?: Record<string, unknown>) => void
): Promise<SendResult> {
  if (transport.kind === 'catcher') {
    try {
      const res = await fetchFn(`${transport.url}/api/v1/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          From: { Email: 'noreply@plus-one.io', Name: 'PlusOne' },
          To: [{ Email: mail.to }],
          Subject: mail.subject,
          Text: mail.text,
          HTML: mail.html,
          Tags: [MAIL_TYPE],
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      return res.ok ? { ok: true, providerMessageId: null } : { ok: false, errorCode: 'provider_unavailable' };
    } catch {
      return { ok: false, errorCode: 'network' };
    }
  }

  let res: Response;
  try {
    res = await fetchFn(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${transport.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': mail.idempotencyKey,
      },
      body: JSON.stringify({
        from: DIGEST_FROM,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        tags: [{ name: 'type', value: MAIL_TYPE }],
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, errorCode: timedOut ? 'timeout' : 'network' };
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = (await res.json()) as unknown;
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (res.ok) return { ok: true, providerMessageId: typeof body.id === 'string' ? body.id : null };

  // Status + Resend's error `name` only: the `message` can quote the address.
  log('resend_failed', { status: res.status, name: typeof body.name === 'string' ? body.name : null });
  if (res.status === 429) return { ok: false, errorCode: failureFor429(body.name) };
  return { ok: false, errorCode: res.status >= 500 ? 'provider_unavailable' : 'provider_rejected' };
}

// ── PostgREST RPC client (service_role) ─────────────────────────────────────
export class RpcError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly pgCode: string | null
  ) {
    super(`rpc_${httpStatus}${pgCode ? `_${pgCode}` : ''}`);
  }
}

async function rpc<T>(deps: DigestDeps, fn: string, args: Record<string, unknown>): Promise<T> {
  const url = `${deps.env.SUPABASE_URL!.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`;
  const key = deps.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    let pgCode: string | null = null;
    try {
      const body = (await res.json()) as { code?: unknown };
      pgCode = typeof body.code === 'string' ? body.code : null;
    } catch {
      pgCode = null;
    }
    throw new RpcError(res.status, pgCode);
  }
  return (await res.json()) as T;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The begin payload, checked: anything malformed is a server problem, never mailed. */
export function parseBegin(raw: unknown): DigestBegin | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.digest_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.digest_date)) return null;
  const isObj = (v: unknown): v is Record<string, number> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(r.subscriptions) || !isObj(r.funnel) || !isObj(r.usage) || !Array.isArray(r.recipients)) return null;
  const recipients: DigestRecipient[] = [];
  for (const item of r.recipients) {
    if (!item || typeof item !== 'object') return null;
    const { id, email } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !UUID.test(id) || typeof email !== 'string' || !email.includes('@')) return null;
    recipients.push({ id, email });
  }
  return {
    digest_date: r.digest_date,
    subscriptions: r.subscriptions as unknown as DigestBegin['subscriptions'],
    funnel: r.funnel as unknown as DigestBegin['funnel'],
    usage: r.usage as unknown as DigestBegin['usage'],
    recipients,
  };
}

// ── handler ─────────────────────────────────────────────────────────────────
export async function handleDigest(req: Request, deps: DigestDeps): Promise<Response> {
  const log = deps.log ?? ((event, fields) => console.log(JSON.stringify({ fn: 'platform-digest', event, ...fields })));

  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // Cheap pre-filter before any DB round trip. Tokens are 64 hex chars.
  const token = req.headers.get('x-platform-digest-token') ?? '';
  if (!/^[0-9a-f]{64}$/.test(token)) return json(401, { error: 'invalid_token' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = deps.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    log('runtime_env_missing');
    return json(500, { error: 'misconfigured' });
  }

  // 1. Authenticate (and consume) before anything else is observable.
  let begin: DigestBegin | null;
  try {
    begin = parseBegin(await rpc<unknown>(deps, 'platform_digest_begin', { p_token: token }));
  } catch (e) {
    if (e instanceof RpcError && e.pgCode === '42501') {
      log('token_refused');
      return json(401, { error: 'invalid_token' });
    }
    if (e instanceof RpcError && (e.httpStatus === 401 || e.httpStatus === 403)) {
      log('service_key_rejected', { status: e.httpStatus });
      return json(502, { error: 'service_key_rejected' });
    }
    log('rpc_failed', { error: e instanceof Error ? e.message : 'unknown' });
    return json(502, { error: 'rpc_failed' });
  }
  if (!begin) {
    log('begin_malformed');
    return json(502, { error: 'rpc_failed' });
  }

  // 2. Only an authenticated caller learns that mail is not configured. No
  //    mail_log row is written then, so nothing claims "sent".
  const transport = mailTransport(deps.env);
  if (transport.kind === 'none') {
    log('mail_not_configured');
    return json(503, { error: 'mail_not_configured' });
  }

  const totals = { recipients: begin.recipients.length, sent: 0, skipped: 0, failed: 0 };
  const rendered = renderPlatformDigest(begin, overviewUrl(deps.env.APP_URL));

  for (const recipient of begin.recipients) {
    let logId: string | null;
    try {
      logId = await rpc<string | null>(deps, 'log_platform_digest_mail', { p_recipient_id: recipient.id });
    } catch (e) {
      // 42501: no longer a platform admin between begin and now. Anything else
      // is a failed attempt with no row; the next run may try again.
      if (e instanceof RpcError && e.pgCode === '42501') totals.skipped += 1;
      else totals.failed += 1;
      log('log_failed', { error: e instanceof Error ? e.message : 'unknown' });
      continue;
    }
    if (!logId) {
      totals.skipped += 1; // today's digest to this recipient is already out
      continue;
    }

    const result = await sendDigest(
      transport,
      { to: recipient.email, ...rendered, idempotencyKey: `mail_log/${logId}` },
      deps.fetch,
      log
    );
    if (result.ok) totals.sent += 1;
    else totals.failed += 1;

    try {
      await rpc(deps, 'record_mail_send_result', {
        p_id: logId,
        p_status: result.ok ? 'sent' : 'failed',
        p_provider_message_id: result.ok ? result.providerMessageId : null,
        p_error_code: result.ok ? null : result.errorCode,
      });
    } catch (e) {
      // The mail went (or didn't) regardless; the row stays 'queued', which
      // the ledger treats as sent, so no second mail goes out today.
      log('settle_failed', { error: e instanceof Error ? e.message : 'unknown' });
    }
  }

  log('done', { ...totals, transport: transport.kind });
  return json(200, totals);
}
