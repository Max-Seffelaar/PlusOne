'use client';

/** Small helpers shared by 2+ settings sections (hub + team/quota/venue/profile/
 *  billing/import): the pushed-screen column wrapper, the inline form-error
 *  renderer, the role multi-select chips, and the real sign-out helper. */
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/client';
import { idbClearAll } from '@/features/door/offline/idb';
import { VENUE_ROLES, ROLE_LABELS, type VenueRole } from '@/features/auth/roles';
import { Icon } from '../../icon';
import { press } from '../../kit';

export const col = 'flex h-full flex-col';

/** Real sign-out (T1 #7/#15): end the Supabase session, land on /login. NB:
 *  supabase-js signOut() DEFAULTS to scope 'global' — 'local' must be explicit
 *  for the this-device variant. 'global' revokes every session server-side =
 *  true "log out everywhere".
 *
 *  Shared-device isolation (86ey9et07): a venue door tablet passes between
 *  successive doorhosts, but the offline door data (outbox + query-cache
 *  snapshot, both in the `plusone-door` IndexedDB) is origin-scoped, not
 *  session-scoped. Without a wipe on sign-out, doorhost B could read A's queued
 *  guest data / plaintext guest names from IndexedDB (no XSS needed), and — worse
 *  — A's un-synced outbox entries would replay under B's session, misattributing
 *  A's check-ins to B in the append-only audit trail. So clear it here, for both
 *  scopes, in a `finally` so the wipe runs even if the network sign-out throws:
 *  local isolation must not hinge on the server round-trip succeeding. */
export async function signOutDevice(scope: 'local' | 'global'): Promise<void> {
  try {
    await createClient().auth.signOut({ scope });
  } finally {
    await idbClearAll();
    window.location.assign('/login');
  }
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
