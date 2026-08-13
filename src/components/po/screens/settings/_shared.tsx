'use client';

/** Small helpers shared by 2+ settings sections (hub + team/quota/venue/profile/
 *  billing/import): the pushed-screen column wrapper, the inline form-error
 *  renderer, the role multi-select chips, and the real sign-out helper. */
import type { JSX } from 'react';
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import { VENUE_ROLES, ROLE_LABELS, type VenueRole } from '@/features/auth/roles';
import { Icon } from '../../icon';
import { Btn, Note, press } from '../../kit';
import { Sheet } from '../../shell';

export const col = 'flex h-full flex-col';

/** Re-exported so the settings screens keep their existing import site. The
 *  implementation moved to `features/auth` (86ey9e9mn) because the MFA wall
 *  needs it too, and `features/*` must not import from `components/po/screens/`. */
export { PendingOutboxError, signOutDevice } from '@/features/auth/sign-out-device';

/**
 * The un-synced-door-writes prompt (86ey9et0h). Shown when `signOutDevice`
 * rejects with `PendingOutboxError` — i.e. the device is offline (or the writes
 * are stuck) and signing out would delete check-ins that only exist here.
 *
 * Staying is the primary action on purpose: the recoverable outcome is the one
 * a tired doorhost should reach for by reflex, and the destructive one names its
 * own cost in the label rather than hiding behind "OK". Shared by the settings
 * hub and the profile screen so both sign-out buttons behave identically.
 */
export function PendingOutboxSheet({
  pending,
  onStay,
  onDiscard,
}: {
  pending: number;
  onStay: () => void;
  onDiscard: () => void;
}): JSX.Element {
  return (
    <Sheet onClose={onStay} center={false}>
      <Note icon="warn">
        <span className="font-bold">{fmt(t.settings.profile.signOutPendingTitle, { n: pending })}</span>
        <br />
        {t.settings.profile.signOutPendingBody}
      </Note>
      <Btn kind="primary" full className="mt-2" onClick={onStay}>
        {t.settings.profile.signOutPendingStay}
      </Btn>
      <Btn kind="ghost" full icon="logout" className="mt-2" onClick={onDiscard}>
        {fmt(t.settings.profile.signOutPendingDiscard, { n: pending })}
      </Btn>
    </Sheet>
  );
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
