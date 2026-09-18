'use client';

/**
 * "Nothing coming up" empty state with a way out: the text, plus a "New event"
 * button for the roles that can create one (admin, and not soft-blocked by
 * billing, #32). Lifted out of Home's add-guest event picker (z8uq9m0hw3,
 * item 1) so the quick-add screen shows the same thing instead of silently
 * picking a PAST event when nothing is upcoming.
 *
 * Reads identity + billing itself so callers only choose the text. `onNewEvent`
 * runs before the navigation, e.g. to close the sheet this sits in.
 */
import type { JSX } from 'react';
import { t } from '@/lib/i18n';
import { useBillingBlocked } from '@/features/po/hooks';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { useNav } from '../context';
import { Btn } from '../kit';

export function NoUpcomingEvents({ text, onNewEvent }: { text: string; onNewEvent?: () => void }): JSX.Element {
  const nav = useNav();
  const isAdmin = usePoIdentity().roles.includes('admin');
  const billingLock = useBillingBlocked();
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <p className="text-[14px] text-faint">{text}</p>
      {isAdmin && !billingLock.blocked && (
        <Btn
          sm
          kind="primary"
          icon="cal"
          className="min-h-[44px]"
          onClick={() => {
            onNewEvent?.();
            nav.push('eventedit', { isNew: true });
          }}
        >
          {t.events.newEvent}
        </Btn>
      )}
    </div>
  );
}
