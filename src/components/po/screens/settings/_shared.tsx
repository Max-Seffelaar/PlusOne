'use client';

/** Small helpers shared by 2+ settings sections (hub + team/quota/venue/profile/
 *  billing/import): the pushed-screen column wrapper, the inline form-error
 *  renderer, the role multi-select chips, and the real sign-out helper. */
import type { JSX } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/client';
import { idbClearAll } from '@/features/door/offline/idb';
import { outbox } from '@/features/door/outbox/store';
import { VENUE_ROLES, ROLE_LABELS, type VenueRole } from '@/features/auth/roles';
import { Icon } from '../../icon';
import { press } from '../../kit';

export const col = 'flex h-full flex-col';

/** Whether an access token still lives in this device's storage. `getSession()`
 *  reads local storage (no server round-trip), so it answers "is a token still
 *  present here", regardless of whether it's still valid server-side. */
async function hasLocalSession(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return data.session != null;
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
 *     outbox singleton (it outlives a route change). Both run network-independently.
 *   - Fail safe against a lingering session: supabase-js SKIPS its local session
 *     removal when the server revoke errors with a non-401/403/404 status (e.g. a
 *     5xx on flaky venue wifi) — and returns `{ error }` rather than throwing. If
 *     we navigated to /login with A's tokens still on the device, middleware ("a
 *     signed-in user has no business on /login → /app") would hand B a live
 *     session as A. So only leave once no token remains: retry a local sign-out
 *     once (clears local tokens on a 401/403 = already-revoked), and if a session
 *     still remains (truly offline) throw instead of redirecting — the caller
 *     surfaces the failure and the device stays on the authed surface rather than
 *     silently handing off an account. */
export async function signOutDevice(scope: 'local' | 'global'): Promise<void> {
  const supabase = createClient();
  try {
    await supabase.auth.signOut({ scope });
  } catch {
    // signOut returns { error } rather than throwing for a failed revoke, but be
    // defensive — the device wipe below must run regardless.
  }
  await idbClearAll();
  outbox.reset();

  if (await hasLocalSession(supabase)) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  }
  if (await hasLocalSession(supabase)) {
    throw new Error('sign-out-incomplete');
  }
  window.location.assign('/login');
}

/** Inline action error, matching the desktop forms' `text-red-300` treatment. */
export function FormError({ error }: { error: unknown }): JSX.Element | null {
  if (!error) return null;
  const msg = error instanceof Error && error.message ? error.message : t.settings.common.formError;
  return (
    <p className="mt-3 text-[12.5px] leading-[1.45] text-red-300" role="alert">
      {msg}
    </p>
  );
}

/** Role multi-select as selectable chips (design language: lavender pill when on,
 *  same pattern as the import-source toggles), shared by the invite form and the
 *  member sheet. Only an admin may toggle `admin` (mirrors the escalation guard /
 *  RLS); a blocked chip dims and shows why. */
export function RolePicker({
  selected,
  toggle,
  callerIsAdmin,
}: {
  selected: VenueRole[];
  toggle: (r: VenueRole) => void;
  callerIsAdmin: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {VENUE_ROLES.map((k) => {
        const on = selected.includes(k);
        const blocked = k === 'admin' && !callerIsAdmin;
        return (
          <button
            key={k}
            type="button"
            disabled={blocked}
            onClick={() => toggle(k)}
            aria-pressed={on}
            className={cn(
              'inline-flex items-center gap-[7px] rounded-full border px-[15px] py-[10px] font-display text-[13.5px] font-bold',
              on ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev text-dim',
              blocked ? 'opacity-40' : press,
            )}
          >
            {on && <Icon name="check" size={14} stroke="#16132B" sw={2.6} />}
            {ROLE_LABELS[k]}
            {blocked && <span className="ml-0.5 text-[10px] font-bold opacity-70">· {t.settings.common.adminOnly}</span>}
          </button>
        );
      })}
    </div>
  );
}
