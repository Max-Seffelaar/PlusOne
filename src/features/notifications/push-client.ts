'use client';

// Push lifecycle on this device (Fase 17 N5, 86ey6bfkb): what the app does with the
// provider's tokens. Transport details stay in the provider; this file owns
// `push_tokens` and the device-local push preferences.
//
// Token storage: a plain upsert on (transport, token) through the USER-SCOPED
// browser client. The body never carries `user_id`, `session_id` or
// `last_seen_at`: the column defaults fill them and the `push_tokens_stamp`
// trigger overwrites all three from the caller's JWT / now() anyway (N2,
// 20260925120000; last_seen_at on UPDATE since 20260925160000). Owner-only RLS
// is the boundary. The trigger also hands a token over when another user
// registers it on the same device (the shared door tablet).
//
// The FCM token never goes into a URL (CLAUDE.md: no PII in query strings — the
// API gateway logs them). Rows are removed by their `id` (remembered from the
// upsert's RETURNING) and by `session_id`, both harmless in a log line.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { getNotificationProvider, type PushPermission, type PushRegistration } from './provider';

type Client = SupabaseClient<Database>;

/** How long sign-out waits for the server-side token delete before moving on. */
export const SIGN_OUT_PUSH_TIMEOUT_MS = 3000;
/** "Not now" on the ask card keeps it away this long. */
export const PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

// ── device-local preferences ─────────────────────────────────────────────────
// PII-free values, per-device conveniences only (CLAUDE.md device-storage rule);
// every `po:push*` key is wiped by signOutDevice so the next person on a shared
// device starts clean.
//
// `po:push` is this device's push state for the signed-in person:
//   absent      never decided — the ask card may show (after its delay)
//   'on'        the person said yes here: register on every start
//   'declined'  the OS prompt came back without a grant — the card never returns
//               (Android 13+ reports a first "Don't allow" as prompt-with-
//               rationale, i.e. still askable, so the OS state alone can't say it)
//   'off'       turned off in Profile, the server row is confirmed gone
//   'off-pending' turned off, but the row delete has not succeeded yet: every
//               start retries it until it does (offline "off" self-heals)
const STATE_KEY = 'po:push';
const SNOOZE_KEY = 'po:push-ask-snooze';
/** The `push_tokens.id` this device last stored — a uuid, what "off" deletes by. */
const ROW_KEY = 'po:push-row';

type PushState = 'on' | 'declined' | 'off' | 'off-pending';

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the preference just doesn't stick */
  }
}

function pushState(): PushState | null {
  const v = readPref(STATE_KEY);
  return v === 'on' || v === 'declined' || v === 'off' || v === 'off-pending' ? v : null;
}

/** The person turned push on for this device (ask card or Profile). */
export function isPushOnHere(): boolean {
  return pushState() === 'on';
}
/** The user turned push off in Profile on this device. */
export function isPushOptedOut(): boolean {
  const s = pushState();
  return s === 'off' || s === 'off-pending';
}
/** The explain-first card may show: nothing was decided on this device yet. */
export function isPushUndecided(): boolean {
  return pushState() === null;
}
export function isPushPromptSnoozed(now = Date.now()): boolean {
  const until = Number(readPref(SNOOZE_KEY));
  return Number.isFinite(until) && until > now;
}
export function snoozePushPrompt(now = Date.now()): void {
  writePref(SNOOZE_KEY, String(now + PROMPT_SNOOZE_MS));
}
export function clearPushPrefs(): void {
  writePref(STATE_KEY, null);
  writePref(SNOOZE_KEY, null);
  writePref(ROW_KEY, null);
}

// ── push_tokens ──────────────────────────────────────────────────────────────
/** The save in flight or done for this app run: dedupes the two listeners that
 *  receive the same `registration` event (register() + the persistent one). */
let saving: { token: string; done: Promise<boolean> } | null = null;


/** The exact upsert body. Exported for the shape test: no user_id, no session_id,
 *  no last_seen_at — the stamp trigger owns all three. */
export function pushTokenRow(reg: PushRegistration) {
  // device_label = the platform only, never a device or person name (no PII).
  return { transport: reg.transport, token: reg.token, device_label: reg.platform };
}

/**
 * Store this device's token. Only while push is 'on' here: a token that arrives
 * late (a `registration` event after the register() timeout, or an FCM refresh)
 * once the person turned push off must not recreate the row.
 */
export function savePushToken(supabase: Client, reg: PushRegistration): Promise<boolean> {
  if (!isPushOnHere()) return Promise.resolve(false);
  if (saving && saving.token === reg.token) return saving.done;
  const done = (async () => {
    const { data, error } = await supabase
      .from('push_tokens')
      .upsert(pushTokenRow(reg), { onConflict: 'transport,token' })
      .select('id')
      .single();
    if (error || !data) return false;
    writePref(ROW_KEY, data.id);
    return true;
  })().catch(() => false);
  const entry = { token: reg.token, done };
  saving = entry;
  void done.then((ok) => {
    if (!ok && saving === entry) saving = null; // a failed save may be retried
  });
  return done;
}

/** `session_id` claim of a Supabase access token (the value N2 stamps on the row). */
export function sessionIdFromAccessToken(jwt: string): string | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))) as { session_id?: unknown };
    return typeof json.session_id === 'string' && json.session_id ? json.session_id : null;
  } catch {
    return null;
  }
}

/**
 * Remove this device's registration server-side: every row bound to the current
 * session, plus the row this device last stored (covers a row registered under an
 * earlier session of the same user). RLS keeps both deletes to own rows. Resolves
 * true only when every delete succeeded (PostgREST reports failure as `{ error }`,
 * never a throw) — or when there was nothing to delete by. An aborted signal
 * leaves the bookkeeping untouched.
 */
export async function deleteThisDevicePushTokens(supabase: Client, signal?: AbortSignal): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const sid = data.session ? sessionIdFromAccessToken(data.session.access_token) : null;
    const rowId = readPref(ROW_KEY);
    const ops: PromiseLike<{ error: unknown }>[] = [];
    const del = () => {
      const q = supabase.from('push_tokens').delete();
      return signal ? q.abortSignal(signal) : q;
    };
    if (sid) ops.push(del().eq('session_id', sid));
    if (rowId) ops.push(del().eq('id', rowId));
    const results = await Promise.all(ops);
    if (signal?.aborted) return false;
    const ok = results.every((r) => !r.error);
    if (ok) {
      writePref(ROW_KEY, null);
      saving = null;
    }
    return ok;
  } catch {
    return false;
  }
}

// ── lifecycle ────────────────────────────────────────────────────────────────
/** Get the token and store it. Silent: null when there is no permission/transport. */
export async function registerPush(supabase: Client): Promise<PushRegistration | null> {
  const reg = await getNotificationProvider().register();
  if (!reg) return null;
  return (await savePushToken(supabase, reg)) ? reg : null;
}

/** Retry a Profile "off" whose row delete failed earlier (offline). */
async function finishPendingOff(supabase: Client): Promise<void> {
  if (await deleteThisDevicePushTokens(supabase)) writePref(STATE_KEY, 'off');
  await getNotificationProvider().unregister();
}

/**
 * App start. Registers again only when the person turned push on here AND the OS
 * allows it (refreshes the row). Never prompts, and never registers a device on
 * the OS grant alone: Android 12 and below report `granted` from install, so the
 * explain-first card is the consent step on every Android version. A pending
 * "off" is finished here. Also abandons an unfinished sign-out push step: the
 * caller is still signed in, and nothing from that step may undo this.
 */
export async function resumePush(supabase: Client): Promise<PushPermission> {
  abandonSignOutStep();
  const provider = getNotificationProvider();
  if (!provider.isSupported()) return 'unsupported';
  const perm = await provider.checkPermission();
  const state = pushState();
  if (state === 'off-pending') await finishPendingOff(supabase);
  else if (state === 'on' && perm === 'granted') await registerPush(supabase);
  return perm;
}

/** An explicit "turn on" (ask card or Profile). Shows the OS prompt if needed. A
 *  result without a grant is remembered, so the ask card does not come back. */
export async function enablePush(supabase: Client): Promise<PushPermission> {
  const perm = await getNotificationProvider().requestPermission();
  if (perm === 'granted') {
    writePref(STATE_KEY, 'on');
    await registerPush(supabase);
  } else if (perm !== 'unsupported' && !isPushOptedOut()) {
    writePref(STATE_KEY, 'declined');
  }
  return perm;
}

/**
 * Profile "off": stop delivering to this device, and remember the choice. The
 * intent is written first (no late token can recreate the row from here on);
 * the row delete must actually succeed, otherwise this throws so Profile shows
 * the error — and the next start retries the delete (`off-pending`).
 */
export async function disablePush(supabase: Client): Promise<void> {
  writePref(STATE_KEY, 'off-pending');
  const ok = await deleteThisDevicePushTokens(supabase);
  await getNotificationProvider().unregister();
  if (!ok) throw new Error('push-off-incomplete');
  writePref(STATE_KEY, 'off');
}

// ── sign-out ─────────────────────────────────────────────────────────────────
/** The sign-out step in flight, abandoned by `resumePush` or by its own timeout. */
let signOutStep: AbortController | null = null;

function abandonSignOutStep(): void {
  // Aborts the request if it is still in flight client-side. Residual: a DELETE
  // that already reached PostgREST executes there regardless; it arrives before
  // the re-registration that follows, so ordering still favours the new row.
  signOutStep?.abort();
  signOutStep = null;
}

/**
 * Sign-out step 1 (called by `signOutDevice` while the session is still alive):
 * delete this device's `push_tokens` rows under the user's own JWT. Never
 * throws, never holds sign-out hostage: offline or on a captive portal it gives
 * up after SIGN_OUT_PUSH_TIMEOUT_MS and aborts the request — a leftover row is
 * inert once the session is gone (dispatch skips dead sessions, the daily prune
 * drops them). Nothing of this step runs after the cap or after `resumePush`
 * abandoned it, so it can never undo the re-registration on the
 * `sign-out-incomplete` path. The transport token is NOT touched here — see
 * `invalidatePushTransportForSignOut`.
 */
export async function unregisterPushForSignOut(supabase: Client): Promise<void> {
  if (!getNotificationProvider().isSupported()) return;
  abandonSignOutStep();
  // Whatever this step manages to delete, the next save must go to the server
  // again (the sign-out-incomplete re-registration), not reuse this run's result.
  saving = null;
  const ctrl = new AbortController();
  signOutStep = ctrl;
  const timer = setTimeout(() => ctrl.abort(), SIGN_OUT_PUSH_TIMEOUT_MS);
  const aborted = new Promise<void>((resolve) => ctrl.signal.addEventListener('abort', () => resolve(), { once: true }));
  try {
    await Promise.race([deleteThisDevicePushTokens(supabase, ctrl.signal), aborted]);
  } finally {
    clearTimeout(timer);
    if (signOutStep === ctrl) signOutStep = null;
  }
}

/**
 * Sign-out step 2 (called only once the session is confirmed gone, right before
 * the device wipe): invalidate the FCM token itself, so the device stops
 * receiving even if the row delete above did not make it. Needs no session, and
 * runs on no path where the user stays signed in. Bounded like step 1.
 */
export async function invalidatePushTransportForSignOut(): Promise<void> {
  const provider = getNotificationProvider();
  if (!provider.isSupported()) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, SIGN_OUT_PUSH_TIMEOUT_MS);
    void provider
      .unregister()
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

/** Tests only: a fresh app run (module state, as on a real app start). */
export function __resetPushClientForTests(): void {
  saving = null;
  signOutStep = null;
}
