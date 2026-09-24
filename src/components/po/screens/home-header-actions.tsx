import { type JSX } from 'react';
import { t } from '@/lib/i18n';
import { Btn } from '../kit';

/**
 * The two primary "start something" actions on Home, one row under the
 * greeting (ADE UX round, item A). On phones the row wraps; every button
 * keeps the kit's ≥44px tap height. Extracted out of home.tsx to keep that
 * file from growing past its existing size.
 */
export function HomeHeaderActions({
  isAdmin,
  showNewGuest,
  onNewEvent,
  onNewGuest,
}: {
  isAdmin: boolean;
  showNewGuest: boolean;
  onNewEvent: () => void;
  onNewGuest: () => void;
}): JSX.Element | null {
  if (!isAdmin && !showNewGuest) return null;

  return (
    <div className="flex flex-wrap gap-2.5">
      {isAdmin && (
        <Btn kind="ghost" sm icon="cal" className="min-h-[44px]" onClick={onNewEvent}>
          {t.home.newEvent}
        </Btn>
      )}
      {showNewGuest && (
        <Btn sm icon="plus" className="min-h-[44px]" onClick={onNewGuest}>
          {t.home.newGuest}
        </Btn>
      )}
    </div>
  );
}
