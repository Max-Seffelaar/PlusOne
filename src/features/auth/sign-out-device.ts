'use client';

/** The one real sign-out. Every surface that ends a session on this device must
 *  go through here — the settings hub, and the MFA wall's "sign out" escape
 *  hatch (86ey9e9mn: that one used to call `supabase.auth.signOut()` raw and
 *  wiped neither IndexedDB nor Cache Storage). Lives in `features/auth` rather
 *  than next to the settings screen so `features/*` never has to import from
 *  `components/po/screens/`. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { idbClearAll } from '@/features/door/offline/idb';
import { clearDeviceCaches } from '@/features/door/offline/sw-cache';
import { getDeviceId } from '@/features/door/offline/device';
import { supabaseGateway } from '@/features/door/outbox/gateway';
import { drainOutbox } from '@/features/door/outbox/replay';
import { outbox } from '@/features/door/outbox/store';
import { isRetryable } from '@/features/door/outbox/types';

/**
 * Thrown when signing out would destroy door writes that never reached the
 * server (86ey9et0h). `pending` is how many. The caller MUST surface this as an
 * explicit choice — never swallow it and never auto-retry with
 * `discardPending`, or the warning is decorative and the check-ins are gone.
 */
/** Same one-liner the door uses (DoorProvider) — no navigator in SSR/tests. */
const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine;

export class PendingOutboxError extends Error {
  constructor(readonly pending: number) {
    super('outbox-pending');
    this.name = 'PendingOutboxError';
  }
}

/**
 * Last chance to get queued door writes to the server before the wipe destroys
 * them. Returns how many still can't be sent.
 *
 * `outbox.init()` first because sign-out is reachable from Settings, where no
 * DoorProvider has ever mounted — without it the in-memory store is empty and
 * we would cheerfully report "nothing pending" while IndexedDB holds a full
 * night of check-ins. `retryErrors()` is included deliberately: a dead-lettered
 * entry is still a guest who physically walked in, the rejection may have been
 * transient (a list unlocked since), and this is the last moment it can ever be
 * retried. Offline we skip straight to the count — there is nothing to try.
 */
async function flushPendingOutbox(supabase: SupabaseClient): Promise<number> {
  await outbox.init();
  if (!outbox.getSnapshot().some(isRetryable)) return 0;
  if (isOnline()) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      outbox.retryErrors();
      await drainOutbox({
        list: () => [...outbox.getSnapshot()],
        update: (id, patch) => outbox.update(id, patch),
        // The session is still alive here — signOut() has not run yet.
        gateway: supabaseGateway(createClient()),
        uid: user.id,
        deviceId: getDeviceId(),
      });
    }
  }
  return outbox.getSnapshot().filter(isRetryable).length;
}

/** Whether an access token still lives in this device's storage. `getSession()`
 *  reads local storage (no server round-trip), so it answers "is a token still
 *  present here", regardless of whether it's still valid server-side. */
async function hasLocalSession(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return data.session != null;
}

/** Wipe every origin-scoped store this device holds for the outgoing user.
 *  Runs only once we know the session is really gone — see `signOutDevice`. */
async function wipeDevice(): Promise<void> {
  await idbClearAll();
  await clearDeviceCaches();
  outbox.reset();
}

/** Real sign-out (T1 #7/#15): end the Supabase session, wipe this device, land on
 *  /login. NB: supabase-js signOut() DEFAULTS to scope 'global' — 'local' must be
 *  explicit for the this-device variant. 'global' revokes every session
 *  server-side = true "log out everywhere".
 *
 *  Shared-device isolation (86ey9et07): a venue door tablet passes between
 *  successive doorhosts, but the door's offline data is origin-scoped, not
 *  session-scoped. Two things must hold before the next person uses the tablet:
 *  (a) none of A's door PII stays readable, and (b) none of A's un-synced outbox
 *  entries can replay under B (which would misattribute A's check-ins to B in the
 *  append-only audit trail). So:
 *   - `idbClearAll()` deletes the persisted `plusone-door` store (outbox +
 *     query-cache snapshot) and bumps the wipe epoch that stops a throttled /
 *     in-flight write from re-creating it; `outbox.reset()` empties the in-memory
 *     outbox singleton (it outlives a route change).
 *   - `clearDeviceCaches()` does the same for Cache Storage (86ey9e9mn): the
 *     service worker caches navigation HTML, and `/app`'s HTML carries the RSC
 *     payload (user id, venue, roles, name, memberships). IndexedDB alone was
 *     only half the wipe. The PII-free offline shell (`plusone-shell-*`) is
 *     deliberately kept so the next doorhost's own login can still cold-start
 *     offline (invariant #25).
 *   - Fail safe against a lingering session: supabase-js SKIPS its local session
 *     removal when the server revoke errors with a non-401/403/404 status (e.g. a
 *     5xx on flaky venue wifi) — and returns `{ error }` rather than throwing. If
 *     we navigated to /login with A's tokens still on the device, middleware ("a
 *     signed-in user has no business on /login → /app") would hand B a live
 *     session as A. So only leave once no token remains: retry a local sign-out
 *     once (clears local tokens on a 401/403 = already-revoked), and if a session
 *     still remains (truly offline) throw instead of redirecting — the caller
 *     surfaces the failure and the device stays on the authed surface rather than
 *     silently handing off an account.
 *
 *  ORDERING (revised by the 86ey9e9mn review — this reverses the original
 *  #233 sequence): the wipe now runs AFTER the session checks pass, immediately
 *  before we leave. On the `sign-out-incomplete` throw path the user stays
 *  signed in *deliberately*, and wiping there was strictly harmful: it destroyed
 *  that still-signed-in doorhost's un-synced check-ins and their offline shell
 *  mid-shift, while closing no hole at all — their session token is still on the
 *  device either way, so nothing was protected by the early wipe. Either we
 *  leave (and the device is wiped) or we stay (and the device is intact and
 *  still theirs). The wipes remain network-independent; only their position
 *  moved. */
export async function signOutDevice(
  scope: 'local' | 'global',
  opts?: { discardPending?: boolean },
): Promise<void> {
  const supabase = createClient();

  // Queued door writes die with the wipe below, so they get one last flight
  // first (86ey9et0h). Online this is silent and the doorhost never learns it
  // happened. Offline there is nothing to send, so the caller is handed the
  // count and must ask — signing out is a deliberate act, but losing a check-in
  // never is. `discardPending` is the answer coming back from that prompt.
  if (!opts?.discardPending) {
    const stillPending = await flushPendingOutbox(supabase);
    if (stillPending > 0) throw new PendingOutboxError(stillPending);
  }

  try {
    await supabase.auth.signOut({ scope });
  } catch {
    // signOut returns { error } rather than throwing for a failed revoke, but be
    // defensive — the checks below must still run.
  }

  if (await hasLocalSession(supabase)) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  }
  if (await hasLocalSession(supabase)) {
    // Still signed in: keep this user's data, surface the failure to the caller.
    throw new Error('sign-out-incomplete');
  }

  await wipeDevice();
  window.location.assign('/login');
}
