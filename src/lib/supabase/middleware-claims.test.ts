import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Perf audit finding 9: the middleware verifies the access token locally
// (getClaims against the project's JWKS) instead of a GoTrue getUser() round
// trip, and falls back to getUser() — the previous behaviour — whenever local
// verification is not possible. Unlike middleware.test.ts nothing is mocked but
// the network: the real @supabase/ssr client reads a real session cookie, the
// token is signed with a real ES256 key (WebCrypto), and `fetch` plays GoTrue.

const KID = 'test-key-1';
const USER = { id: '0199a000-0000-7000-8000-000000000001', email: 'staff@venue.test' };

type Calls = { jwks: number; user: number; token: number };
let calls: Calls;
// Any URL the fake GoTrue does not serve (e.g. a `jku` an attacker points at).
let unexpected: string[];
let jwksStatus: number;
let userStatus: number;
let signingKey: CryptoKeyPair;
let otherKey: CryptoKeyPair;
let publicJwk: JsonWebKey;
// Each test needs a cold JWKS cache (auth-js keeps it in module scope).
let urlSeq = 0;
let projectUrl = '';

const b64url = (bytes: Uint8Array | string): string =>
  Buffer.from(typeof bytes === 'string' ? bytes : bytes).toString('base64url');

async function sign(
  header: Record<string, unknown> | string,
  payload: Record<string, unknown>,
  key: CryptoKey | null
): Promise<string> {
  const rawHeader = typeof header === 'string' ? header : JSON.stringify(header);
  const head = `${b64url(rawHeader)}.${b64url(JSON.stringify(payload))}`;
  if (!key) return `${head}.${b64url('not-a-signature')}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(head));
  return `${head}.${b64url(new Uint8Array(sig))}`;
}

function claims(expInSeconds = 3600): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: USER.id,
    email: USER.email,
    role: 'authenticated',
    aud: 'authenticated',
    session_id: 's-1',
    iat: now,
    exp: now + expInSeconds,
  };
}

function sessionCookie(accessToken: string, expInSeconds = 3600): string {
  const session = {
    access_token: accessToken,
    refresh_token: 'refresh-1',
    token_type: 'bearer',
    expires_in: expInSeconds,
    expires_at: Math.floor(Date.now() / 1000) + expInSeconds,
    user: { id: USER.id, email: USER.email, aud: 'authenticated', role: 'authenticated' },
  };
  return `${cookieName()}=base64-${b64url(JSON.stringify(session))}`;
}

function cookieName(): string {
  return `sb-${new URL(projectUrl).hostname.split('.')[0]}-auth-token`;
}

// GoTrue stamps its API version; auth-js only reads `code` from versioned responses.
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
  });

beforeAll(async () => {
  signingKey = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  otherKey = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  publicJwk = { ...(await crypto.subtle.exportKey('jwk', signingKey.publicKey)), kid: KID, alg: 'ES256', use: 'sig' } as JsonWebKey;
});

beforeEach(() => {
  calls = { jwks: 0, user: 0, token: 0 };
  unexpected = [];
  jwksStatus = 200;
  userStatus = 200;
  projectUrl = `https://proj${String(++urlSeq).padStart(4, '0')}abcdefgh.supabase.co`;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', projectUrl);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('REVIEW_LOGIN_CODE', '');
  vi.stubEnv('REVIEW_LOGIN_EXPIRES_AT', '');
  // auth-js logs a failed refresh; expected in the expired-token case.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === '/auth/v1/.well-known/jwks.json') {
        calls.jwks++;
        return jwksStatus === 200 ? json(200, { keys: [publicJwk] }) : json(jwksStatus, { message: 'down' });
      }
      if (url.pathname === '/auth/v1/user') {
        calls.user++;
        return userStatus === 200
          ? json(200, { ...USER, aud: 'authenticated', role: 'authenticated' })
          : json(userStatus, { code: userStatus === 403 ? 'session_not_found' : 'bad_jwt', message: 'nope' });
      }
      if (url.pathname === '/auth/v1/token') {
        calls.token++;
        return json(400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' });
      }
      unexpected.push(url.href);
      throw new Error(`unexpected fetch ${url.href}`);
    })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function run(cookie: string | null, opts?: { strict?: boolean }) {
  const { updateSession } = await import('./middleware');
  const headers: Record<string, string> = cookie ? { cookie } : {};
  return updateSession(new NextRequest('http://localhost:3000/app', { headers }), opts);
}

const es256 = async (payload = claims(), key: CryptoKey | null = signingKey.privateKey) =>
  sign({ alg: 'ES256', typ: 'JWT', kid: KID }, payload, key);

describe('resolveMiddlewareUser — asymmetric token (prod)', () => {
  it('valid ES256 token → user from the claims, no GoTrue /user call', async () => {
    const res = await run(sessionCookie(await es256()));
    expect(res.user).toEqual(USER);
    expect(calls).toEqual({ jwks: 1, user: 0, token: 0 });
  });

  it('JWKS is cached across requests (one fetch for two requests)', async () => {
    const cookie = sessionCookie(await es256());
    await run(cookie);
    const second = await run(cookie);
    expect(second.user).toEqual(USER);
    expect(calls).toEqual({ jwks: 1, user: 0, token: 0 });
  });

  it('JWKS unreachable → falls back to getUser(), same answer as before', async () => {
    jwksStatus = 503;
    const res = await run(sessionCookie(await es256()));
    expect(res.user).toEqual(USER);
    expect(calls.user).toBe(1);
  });

  it('JWKS unreachable AND GoTrue rejects → no user (never fails open)', async () => {
    jwksStatus = 503;
    userStatus = 401;
    const res = await run(sessionCookie(await es256()));
    expect(res.user).toBeNull();
  });

  it('forged signature (other key, same kid) → GoTrue decides, and it rejects', async () => {
    userStatus = 401;
    const res = await run(sessionCookie(await es256(claims(), otherKey.privateKey)));
    expect(res.user).toBeNull();
    expect(calls.user).toBe(1);
  });

  it('garbage signature → GoTrue decides', async () => {
    userStatus = 401;
    const res = await run(sessionCookie(await es256(claims(), null)));
    expect(res.user).toBeNull();
    expect(calls.user).toBe(1);
  });

  it('expired token with a dead refresh token → refresh fails, no user', async () => {
    const res = await run(sessionCookie(await es256(claims(-60)), -60));
    expect(res.user).toBeNull();
    expect(calls.token).toBeGreaterThanOrEqual(1);
  });

  it('token without a subject → never a user from the fast path', async () => {
    userStatus = 401;
    const noSub = claims();
    delete noSub.sub;
    const res = await run(sessionCookie(await es256(noSub)));
    expect(res.user).toBeNull();
    expect(calls.user).toBe(1);
  });

  // Documented trade-off (PR body): a session revoked server-side keeps a valid
  // access token until `exp`; the fast path accepts it, exactly as PostgREST
  // and Realtime already do. The /app layout, data pages and server actions
  // still call getUser() and refuse it.
  it('revoked session, token not yet expired → accepted until exp (accepted residual)', async () => {
    userStatus = 403;
    const res = await run(sessionCookie(await es256()));
    expect(res.user).toEqual(USER);
    expect(calls.user).toBe(0);
  });

  it('strict → always GoTrue, so a revoked session is refused', async () => {
    userStatus = 403;
    const res = await run(sessionCookie(await es256()), { strict: true });
    expect(res.user).toBeNull();
    expect(calls).toEqual({ jwks: 0, user: 1, token: 0 });
  });
});

describe('resolveMiddlewareUser — symmetric token (local stack): exactly as before', () => {
  const hs256 = (payload = claims()) => sign({ alg: 'HS256', typ: 'JWT' }, payload, null);

  it('HS256 → one getUser(), no JWKS fetch', async () => {
    const res = await run(sessionCookie(await hs256()));
    expect(res.user).toEqual(USER);
    expect(calls).toEqual({ jwks: 0, user: 1, token: 0 });
  });

  it('HS256 rejected by GoTrue → no user', async () => {
    userStatus = 401;
    const res = await run(sessionCookie(await hs256()));
    expect(res.user).toBeNull();
    expect(calls).toEqual({ jwks: 0, user: 1, token: 0 });
  });

  it('asymmetric alg but no kid → GoTrue', async () => {
    const token = await sign({ alg: 'ES256', typ: 'JWT' }, claims(), signingKey.privateKey);
    const res = await run(sessionCookie(token));
    expect(res.user).toEqual(USER);
    expect(calls).toEqual({ jwks: 0, user: 1, token: 0 });
  });

  it('no session cookie → no user, no network', async () => {
    const res = await run(null);
    expect(res.user).toBeNull();
    expect(calls).toEqual({ jwks: 0, user: 0, token: 0 });
  });
});

// Forged-token cases from the fresh-session review of #483: every one must end
// with no user unless GoTrue itself vouches, and never fetch anything but the
// project's own JWKS / GoTrue.
describe('resolveMiddlewareUser — forged tokens never fail open', () => {
  afterEach(() => expect(unexpected).toEqual([]));

  it('unknown kid, GoTrue rejects → no user, ONE GoTrue call (auth-js already asked)', async () => {
    userStatus = 401;
    const token = await sign({ alg: 'ES256', typ: 'JWT', kid: 'attacker-kid' }, claims(), otherKey.privateKey);
    const res = await run(sessionCookie(token));
    expect(res.user).toBeNull();
    expect(calls.user).toBe(1);
  });

  it('unknown kid (e.g. a key just rotated out), GoTrue accepts → user, still one call', async () => {
    const token = await sign({ alg: 'ES256', typ: 'JWT', kid: 'rotated-kid' }, claims(), signingKey.privateKey);
    const res = await run(sessionCookie(token));
    expect(res.user).toEqual(USER);
    expect(calls.user).toBe(1);
  });

  it.each([
    ['alg none + a known kid', { alg: 'none', typ: 'JWT', kid: KID }],
    ['RS256 header over the EC key', { alg: 'RS256', typ: 'JWT', kid: KID }],
    ['lowercase hs256 + kid', { alg: 'hs256', typ: 'JWT', kid: KID }],
    ['jku pointing at an attacker JWKS', { alg: 'ES256', typ: 'JWT', kid: KID, jku: 'https://attacker.example/jwks.json' }],
  ])('%s → no user', async (_l, header) => {
    userStatus = 401;
    const res = await run(sessionCookie(await sign(header, claims(), otherKey.privateKey)));
    expect(res.user).toBeNull();
  });

  it('duplicate "alg" key (last one wins for both parsers) → no user', async () => {
    userStatus = 401;
    const header = `{"alg":"ES256","alg":"HS256","typ":"JWT","kid":"${KID}"}`;
    const res = await run(sessionCookie(await sign(header, claims(), otherKey.privateKey)));
    expect(res.user).toBeNull();
  });

  it('cookie says not expired, JWT exp is in the past → validateExp refuses, GoTrue decides', async () => {
    userStatus = 401;
    const res = await run(sessionCookie(await es256(claims(-60)), 3600));
    expect(res.user).toBeNull();
    expect(calls.token).toBe(0);
  });
});

// Delta review of #483: auth-js turns ANY non-5xx JSON error into an
// AuthApiError, including the JWKS fetch's. Those must fall back to getUser()
// exactly like a JWKS outage — a null here would loop /app ↔ /login.
describe('resolveMiddlewareUser — JWKS 4xx falls back to GoTrue (no loop)', () => {
  it.each([429, 404, 400, 401, 403])('JWKS %i → getUser(), signed-in user kept', async (status) => {
    jwksStatus = status;
    const res = await run(sessionCookie(await es256()));
    expect(res.user).toEqual(USER);
    expect(calls.jwks).toBe(1);
    expect(calls.user).toBe(1);
  });

  it('JWKS 429 AND GoTrue rejects → no user (still never fails open)', async () => {
    jwksStatus = 429;
    userStatus = 401;
    const res = await run(sessionCookie(await es256()));
    expect(res.user).toBeNull();
  });
});
