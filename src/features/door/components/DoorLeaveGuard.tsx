'use client';

/**
 * Native back on the standalone door must not leave silently while the outbox
 * still holds unsynced writes (86ey6bfdm, review B1). Leaving is a client-side
 * `router.replace('/door')`, so DoorProvider's `beforeunload` prompt never
 * fires; once the route unmounts, the door's flush loop stops and the queue
 * sits in IndexedDB until a door opens again.
 *
 * Reads the per-event count through the door's public `useDoor().pendingCount`
 * (the same number the sync bar shows) — no second outbox reader. With work
 * pending, a navigating back asks first; Stay (or back again) keeps the door
 * up, Leave goes. Offline back never reaches this: it is already a no-op (#25).
 * Renders inside DoorProvider, beside the screen; nothing when idle.
 */
import { type JSX, useState } from 'react';
import { ConfirmSheet } from '@/components/po/shell';
import { useNativeBackIntercept, useNativeLeaveGuard } from '@/components/po/native-back-intercept';
import { fmt, t } from '@/lib/i18n';
import { useDoor } from '../DoorProvider';

export function DoorLeaveGuard(): JSX.Element | null {
  const { pendingCount } = useDoor();
  const [leave, setLeave] = useState<(() => void) | null>(null);

  useNativeLeaveGuard(pendingCount > 0 ? (go) => setLeave(() => go) : null);
  // Back while the confirm is up = Stay.
  useNativeBackIntercept(leave ? () => setLeave(null) : null);

  if (!leave) return null;
  const stay = (): void => setLeave(null);
  return (
    <ConfirmSheet
      icon="warn"
      confirmIcon="logout"
      title={t.door.leaveUnsyncedTitle}
      confirmLabel={t.door.leaveUnsyncedLeave}
      onConfirm={() => {
        setLeave(null);
        leave();
      }}
      cancelLabel={t.door.leaveUnsyncedStay}
      onClose={stay}
    >
      <p className="text-[13px] leading-[1.5] text-dim">
        {pendingCount === 1 ? t.door.leaveUnsyncedBodyOne : fmt(t.door.leaveUnsyncedBody, { n: pendingCount })}
      </p>
    </ConfirmSheet>
  );
}
