// push-dispatch core (Fase 17 N2, 86ey6bfbe) — runtime-agnostic on purpose:
// only fetch + WebCrypto + atob/btoa, which Deno (the Edge runtime) and Node 22
// (vitest in CI) both provide. index.ts is the thin Deno entry; the unit suite
// (tests/unit/push-dispatch.test.ts) drives handleDispatch() with a mocked
// fetch, because CI does not run Deno tests.
//
// What this function does, and nothing more:
//   1. drain notification_outbox through the service_role RPCs of
//      20260925120100 (claim → send → complete), never taking notification
//      content from the request;
//   2. send each row to the recipient's live FCM tokens via FCM HTTP v1, with
//      an OAuth2 access token minted from the service account (RS256 JWT);
//   3. prune tokens FCM reports as permanently dead.
//
// Caller auth: the x-push-dispatch-secret header is passed to
// claim_push_outbox(), which compares it with the Vault secret and raises
// 42501 otherwise — so the secret lives in one place (Vault) and this code
// never holds a copy to compare against.
//
// Never logged: the service-account JSON, the access token, device tokens,
// the caller's secret, FCM error messages (only their error codes).

export interface DispatchEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  FCM_SERVICE_ACCOUNT_JSON?: string;
  FCM_PROJECT_ID?: string;
}

export interface DispatchDeps {
  env: DispatchEnv;
  fetch: typeof fetch;
  /** Epoch milliseconds; injectable for tests. */
  now?: () => number;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

export interface ClaimedRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  tokens: { id: string; token: string }[];
}

export type SendResult =
  | { kind: 'ok' }
  | { kind: 'prune'; code: string }
  | { kind: 'transient'; code: string }
  | { kind: 'permanent'; code: string };

export type RowOutcome = 'sent' | 'skipped' | 'retry' | 'failed';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const BATCH_SIZE = 50;
const MAX_BATCHES = 5;

// ── copy ─────────────────────────────────────────────────────────────────────
// English (the app's only locale). Generic by design: no guest or member names
// travel through Google/Apple; the app resolves details after the tap.
export function notificationFor(
  kind: string,
  payload: Record<string, unknown>
): { title: string; body: string } | null {
  switch (kind) {
    case 'quota_request_created':
      return { title: 'New quota request', body: 'A team member asked for extra guest list spots.' };
    case 'guest_request_created':
      return { title: 'New guest request', body: 'Someone asked to join the guest list.' };
    case 'quota_request_decided':
      return payload.status === 'approved'
        ? { title: 'Quota request approved', body: 'Your extra guest list spots were approved.' }
        : { title: 'Quota request declined', body: 'Your request for extra guest list spots was declined.' };
    default:
      return null;
  }
}

// ── encoding helpers ─────────────────────────────────────────────────────────
function base64UrlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(s: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(s));
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// ── service account + OAuth ─────────────────────────────────────────────────
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string') return null;
    const tokenUri = typeof sa.token_uri === 'string' && sa.token_uri ? sa.token_uri : DEFAULT_TOKEN_URI;
    return { client_email: sa.client_email, private_key: sa.private_key, token_uri: tokenUri };
  } catch {
    return null;
  }
}

/** RS256-signed JWT assertion for the OAuth2 jwt-bearer grant. */
export async function signServiceAccountJwt(sa: ServiceAccount, nowMs: number): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const header = base64UrlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64UrlFromString(
    JSON.stringify({ iss: sa.client_email, scope: FCM_SCOPE, aud: sa.token_uri, iat, exp: iat + 3600 })
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signingInput = `${header}.${claims}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(sig))}`;
}

export async function fetchAccessToken(
  sa: ServiceAccount,
  fetchFn: typeof fetch,
  nowMs: number
): Promise<string> {
  const assertion = await signServiceAccountJwt(sa, nowMs);
  const res = await fetchFn(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!res.ok) throw new Error(`oauth_${res.status}`);
  const json = (await res.json()) as { access_token?: unknown };
  if (typeof json.access_token !== 'string' || !json.access_token) throw new Error('oauth_no_token');
  return json.access_token;
}

// ── FCM send + classification ───────────────────────────────────────────────
interface FcmErrorBody {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: { '@type'?: string; errorCode?: string }[];
  };
}

/**
 * Map an FCM v1 error to what we do with the TOKEN and the ROW.
 * prune     — the token is dead for good (UNREGISTERED, SENDER_ID_MISMATCH,
 *             or INVALID_ARGUMENT that names the registration token).
 * transient — worth retrying the row (429, 5xx, auth/config problems that
 *             a fixed secret resolves).
 * permanent — the request itself is wrong (INVALID_ARGUMENT about anything
 *             but the token); retrying cannot help, and pruning would wrongly
 *             wipe every token on a payload bug.
 */
export function classifyFcmError(httpStatus: number, body: FcmErrorBody | null): SendResult {
  const err = body?.error;
  const fcmCode = err?.details?.find((d) => d['@type']?.endsWith('google.firebase.fcm.v1.FcmError'))?.errorCode;
  const code = fcmCode ?? err?.status ?? `HTTP_${httpStatus}`;

  if (code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH') return { kind: 'prune', code };
  if (code === 'INVALID_ARGUMENT') {
    return /registration token/i.test(err?.message ?? '')
      ? { kind: 'prune', code }
      : { kind: 'permanent', code };
  }
  if (httpStatus === 404) return { kind: 'prune', code };
  return { kind: 'transient', code };
}

export async function sendToToken(
  fetchFn: typeof fetch,
  projectId: string,
  accessToken: string,
  deviceToken: string,
  row: ClaimedRow
): Promise<SendResult> {
  const notification = notificationFor(row.kind, row.payload);
  if (!notification) return { kind: 'permanent', code: 'UNKNOWN_KIND' };

  // FCM data values must be strings.
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(row.payload)) {
    if (v !== null && v !== undefined) data[k] = String(v);
  }

  let res: Response;
  try {
    res = await fetchFn(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: deviceToken, notification, data } }),
      }
    );
  } catch {
    return { kind: 'transient', code: 'NETWORK' };
  }
  if (res.ok) return { kind: 'ok' };

  let body: FcmErrorBody | null = null;
  try {
    body = (await res.json()) as FcmErrorBody;
  } catch {
    body = null;
  }
  return classifyFcmError(res.status, body);
}

/** Aggregate per-token results into the row's outcome. */
export function rowOutcome(results: SendResult[]): { outcome: RowOutcome; error: string | null } {
  const codes = Array.from(
    new Set(results.filter((r) => r.kind !== 'ok').map((r) => (r as { code: string }).code))
  );
  const error = codes.length ? `fcm:${codes.join(',')}`.slice(0, 500) : null;
  if (results.some((r) => r.kind === 'ok')) return { outcome: 'sent', error };
  if (results.some((r) => r.kind === 'transient')) return { outcome: 'retry', error };
  if (results.some((r) => r.kind === 'permanent')) return { outcome: 'failed', error };
  return { outcome: 'skipped', error: error ?? 'no live device tokens' };
}

// ── PostgREST RPC client (service_role) ─────────────────────────────────────
class RpcError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly pgCode: string | null
  ) {
    super(`rpc_${httpStatus}${pgCode ? `_${pgCode}` : ''}`);
  }
}

async function rpc<T>(
  deps: DispatchDeps,
  fn: string,
  args: Record<string, unknown>
): Promise<T> {
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── handler ─────────────────────────────────────────────────────────────────
export async function handleDispatch(req: Request, deps: DispatchDeps): Promise<Response> {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((event, fields) => console.log(JSON.stringify({ fn: 'push-dispatch', event, ...fields })));

  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // Cheap pre-filter before any DB round trip; the real check is in the RPC.
  const secret = req.headers.get('x-push-dispatch-secret') ?? '';
  if (secret.length < 32 || secret.length > 512) return json(401, { error: 'unauthorized' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FCM_PROJECT_ID } = deps.env;
  const sa = parseServiceAccount(deps.env.FCM_SERVICE_ACCOUNT_JSON);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !FCM_PROJECT_ID || !sa) {
    // Not configured: claim nothing, so no attempt is burned while asleep.
    log('not_configured');
    return json(503, { error: 'unavailable' });
  }

  const totals = { claimed: 0, sent: 0, skipped: 0, retry: 0, failed: 0, pruned: 0 };
  let accessToken: string | null = null;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    let rows: ClaimedRow[];
    try {
      rows = await rpc<ClaimedRow[]>(deps, 'claim_push_outbox', { p_secret: secret, p_limit: BATCH_SIZE });
    } catch (e) {
      if (e instanceof RpcError && (e.pgCode === '42501' || e.httpStatus === 401 || e.httpStatus === 403)) {
        log('unauthorized');
        return json(401, { error: 'unauthorized' });
      }
      log('claim_failed', { error: e instanceof Error ? e.message : 'unknown' });
      return json(502, { error: 'claim_failed', ...totals });
    }
    if (rows.length === 0) break;
    totals.claimed += rows.length;

    if (!accessToken) {
      try {
        accessToken = await fetchAccessToken(sa, deps.fetch, now());
      } catch (e) {
        const code = e instanceof Error ? e.message : 'oauth_error';
        log('oauth_failed', { error: code });
        for (const row of rows) {
          await rpc(deps, 'complete_push_outbox', { p_id: row.id, p_outcome: 'retry', p_error: code }).catch(() => undefined);
        }
        totals.retry += rows.length;
        return json(502, { error: 'oauth_failed', ...totals });
      }
    }

    const prune: string[] = [];
    for (const row of rows) {
      const results = await Promise.all(
        row.tokens.map(async (t) => {
          const r = await sendToToken(deps.fetch, FCM_PROJECT_ID, accessToken!, t.token, row);
          if (r.kind === 'prune') prune.push(t.id);
          return r;
        })
      );
      const { outcome, error } = rowOutcome(results);
      totals[outcome] += 1;
      try {
        await rpc(deps, 'complete_push_outbox', { p_id: row.id, p_outcome: outcome, p_error: error });
      } catch (e) {
        // The sweep puts a row stuck in 'sending' back after 5 minutes.
        log('complete_failed', { error: e instanceof Error ? e.message : 'unknown' });
      }
    }

    if (prune.length) {
      try {
        totals.pruned += await rpc<number>(deps, 'prune_push_tokens', { p_ids: prune });
      } catch (e) {
        log('prune_failed', { error: e instanceof Error ? e.message : 'unknown' });
      }
    }

    if (rows.length < BATCH_SIZE) break;
  }

  log('done', totals);
  return json(200, totals);
}
