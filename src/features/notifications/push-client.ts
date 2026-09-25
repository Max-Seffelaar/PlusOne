'use client';

// Push lifecycle on this device (Fase 17 N5, 86ey6bfkb): what the app does with the
// provider's tokens. Transport details stay in the provider; this file owns
// `push_tokens` and the two device-local preferences.
//
// Token storage: a plain upsert on (transport, token) through the USER-SCOPED
// browser client. The body never carries `user_id` or `session_id`: the column
// defaults fill them and the `push_tokens_stamp` trigger overwrites them from the
// caller's JWT anyway (N2, 20260925120000). Owner-only RLS is the boundary. The
// trigger also hands a token over when another user registers it on the same
// device (the shared door tablet).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { getNotificationProvider, type PushPermission, type PushRegistration } from './provider';

type Client = SupabaseClient<Database>;

/** How long sign-out waits for the server-side token delete before moving on. */
export const SIGN_OUT_PUSH_TIMEOUT_MS = 3000;
/** "Not now" on the ask card keeps it away this long. */
export const PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

// ── device-local preferences ─────────────────────────────────────────────────
// PII-free flags, per-device conveniences only (CLAUDE.md device-storage rule);
// wiped by signOutDevice so the next person on a shared device starts clean.
const OPT_OUT_KEY = 'po:push-off';
const SNOOZE_KEY = 'po:push-ask-snooze';

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

/** The user turned push off in Profile on this device. */
export function isPushOptedOut(): boolean {
  return readPref(OPT_OUT_KEY) === '1';
}
export function isPushPromptSnoozed(now = Date.now()): boolean {
  const until = Number(readPref(SNOOZE_KEY));
  return Number.isFinite(until) && until > now;
}
export function snoozePushPrompt(now = Date.now()): void {
  writePref(SNOOZE_KEY, String(now + PROMPT_SNOOZE_MS));
}
export function clearPushPrefs(): void {
  writePref(OPT_OUT_KEY, null);
  writePref(SNOOZE_KEY, null);
}

// ── push_tokens ──────────────────────────────────────────────────────────────
/** The token this app run last stored — what sign-out removes by value. */
let currentToken: string | null = null;

/** The exact upsert body. Exported for the shape test: no user_id, no session_id. */
export function pushTokenRow(reg: PushRegistration, now = new Date()) {
  return {
    transport: reg.transport,
    token: reg.token,
    // Platform only — never a device or person name (column comment: no PII).
    device_label: 'android',
    // The stamp trigger sets last_seen_at on INSERT only; on the conflict (UPDATE)
    // path this is what keeps an active device out of the 90-day TTL sweep.
    last_seen_at: now.toISOString(),
  };
}

export async function savePushToken(supabase: Client, reg: PushRegistration): Promise<boolean> {
  const { error } = await supabase.from('push_tokens').upsert(pushTokenRow(reg), { onConflict: 'transport,token' });
  if (error) return false;
  currentToken = reg.token;
  return true;
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

/** Remove this device's registration server-side: every row bound to the current
 *  session, plus the token this run stored (covers a row registered under an
 *  earlier session of the same user). RLS keeps both deletes to own rows. */
export async function deleteThisDevicePushTokens(supabase: Client): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const sid = data.session ? sessionIdFromAccessToken(data.session.access_token) : null;
  const ops: PromiseLike<unknown>[] = [];
  if (sid) ops.push(supabase.from('push_tokens').delete().eq('session_id', sid));
  if (currentToken) ops.push(supabase.from('push_tokens').delete().eq('transport', 'fcm').eq('token', currentToken));
  await Promise.all(ops);
  currentToken = null;
}

// ── lifecycle ────────────────────────────────────────────────────────────────
/** Get the token and store it. Silent: null when there is no permission/transport. */
export async function registerPush(supabase: Client): Promise<PushRegistration | null> {
  const reg = await getNotificationProvider().register();
  if (!reg) return null;
  return (await savePushToken(supabase, reg)) ? reg : null;
}

/** App start: register again when the user already said yes (refreshes the row). */
export async function resumePush(supabase: Client): Promise<PushPermission> {
  const provider = getNotificationProvider();
  if (!provider.isSupported()) return 'unsupported';
  const perm = await provider.checkPermission();
  if (perm === 'granted' && !isPushOptedOut()) await registerPush(supabase);
  return perm;
}

/** An explicit "turn on" (ask card or Profile). Shows the OS prompt if needed. */
export async function enablePush(supabase: Client): Promise<PushPermission> {
  const perm = await getNotificationProvider().requestPermission();
  if (perm === 'granted') {
    writePref(OPT_OUT_KEY, null);
    await registerPush(supabase);
  }
  return perm;
}

/** Profile "off": stop delivering to this device, and remember the choice. */
export async function disablePush(supabase: Client): Promise<void> {
  writePref(OPT_OUT_KEY, '1');
  await deleteThisDevicePushTokens(supabase).catch(() => undefined);
  await getNotificationProvider().unregister();
}

function within(ms: number, work: Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void work.catch(() => undefined).finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Sign-out step (called by `signOutDevice` while the session is still alive, before
 * the IDB/cache wipe). Deletes this device's `push_tokens` rows under the user's
 * own JWT, then invalidates the FCM token itself. Never throws, and never holds
 * sign-out hostage: offline or on a captive portal it gives up after
 * SIGN_OUT_PUSH_TIMEOUT_MS — a leftover row is inert once the session is gone
 * (dispatch skips dead sessions, the daily prune drops them).
 */
export async function unregisterPushForSignOut(supabase: Client): Promise<void> {
  const provider = getNotificationProvider();
  if (!provider.isSupported()) return;
  await within(
    SIGN_OUT_PUSH_TIMEOUT_MS,
    // The FCM token is invalidated even when the row delete failed: either one
    // alone already stops delivery to this device.
    deleteThisDevicePushTokens(supabase)
      .catch(() => undefined)
      .then(() => provider.unregister()),
  );
}
