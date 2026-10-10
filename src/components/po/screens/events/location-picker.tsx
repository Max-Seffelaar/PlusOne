'use client';

/**
 * Saved-location chips on the event form (z8uq9m444c). A tap copies that
 * location's name + address into the two fields below, which stay editable for
 * a one-off. The event stores the copy, so later edits or archiving in Company
 * settings never move it. Split out of `edit.tsx` to keep the form under the
 * 800-LOC line; same chip skin and 44px ring as the template picker. No
 * `truncate`: its overflow:hidden would clip the ring's ::before (tap area).
 */
import type { JSX } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { toEventLocationCopy, type PoCompanyLocation } from '@/features/po/adapters';
import { hitRingY6 } from '../../kit';

export function LocationPicker({
  locations,
  name,
  address,
  onPick,
}: {
  locations: readonly PoCompanyLocation[];
  /** The form's current values: a chip is active when they match its copy. */
  name: string;
  address: string;
  onPick: (copy: { locationName: string; locationAddress: string }) => void;
}): JSX.Element | null {
  if (locations.length === 0) return null;
  return (
    <div role="group" aria-label={t.events.savedLocationsAria} className="mb-[12px] flex flex-wrap gap-x-2 gap-y-[10px]">
      {locations.map((loc) => {
        const copy = toEventLocationCopy(loc);
        const active = name.trim() === copy.locationName && address.trim() === copy.locationAddress;
        return (
          <button
            key={loc.id}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(copy)}
            className={cn(
              'max-w-full break-words rounded-full border px-[13px] py-[7px] font-display text-[12.5px] font-bold transition-colors',
              hitRingY6,
              active ? 'border-acc bg-acc-dim text-acc' : 'border-line text-dim hover:brightness-110',
            )}
          >
            {loc.name}
          </button>
        );
      })}
    </div>
  );
}
