'use client';

/**
 * The event form's date/time block: start date + doors, end date + end time.
 * Extracted from `edit.tsx` (ADE UX round, item C1) so the screen file stays
 * well under the 800-LOC line and the auto-fill rule lives in one place.
 *
 * Auto-fill: as long as the user has not touched an end field, every change to
 * the start date or doors time re-derives BOTH end fields as "doors + 6 h"
 * (`deriveEnd`). The first manual edit of an end field stops that (`endTouched`),
 * and clearing the end date arms it again. In edit mode an event that already
 * has an end starts as touched, so a stored end is never silently rewritten.
 *
 * Capacitor-safe (#37): no browser-only API here — the fields themselves guard
 * `matchMedia` (datetime-field.tsx).
 */
import type { JSX } from 'react';
import { t } from '@/lib/i18n';
import { deriveEnd } from '@/features/events/derive-end';
import { DateField, TimeField } from '../../datetime-field';
import { Label } from '../../kit';

export interface Schedule {
  date: string;
  time: string;
  endDate: string;
  endTime: string;
}

export function ScheduleFields({
  value,
  onChange,
  endTouched,
  onEndTouchedChange,
  writable,
}: {
  value: Schedule;
  onChange: (next: Schedule) => void;
  endTouched: boolean;
  onEndTouchedChange: (touched: boolean) => void;
  writable: boolean;
}): JSX.Element {
  /** A start-side change: re-derive the end while the user hasn't claimed it. */
  const setStart = (patch: Partial<Pick<Schedule, 'date' | 'time'>>): void => {
    const date = patch.date ?? value.date;
    const time = patch.time ?? value.time;
    if (endTouched) {
      onChange({ ...value, date, time });
      return;
    }
    const { endDateStr, endTimeStr } = deriveEnd(date, time);
    onChange({ date, time, endDate: endDateStr, endTime: endTimeStr });
  };

  const setEndDate = (v: string): void => {
    // Clearing the end date hands it back to the start fields.
    if (!v) {
      onEndTouchedChange(false);
      onChange({ ...value, endDate: '', endTime: '' });
      return;
    }
    onEndTouchedChange(true);
    onChange({ ...value, endDate: v });
  };

  const setEndTime = (v: string): void => {
    onEndTouchedChange(true);
    onChange({ ...value, endTime: v });
  };

  return (
    <>
      {/* min-w-0 lets both columns shrink inside narrow viewports (flex default
          min-width:auto made the date column push the time field off-screen);
          the date gets the wider share, the time needs little. */}
      <div className="mb-[14px] flex gap-[10px]">
        <div className="min-w-0 flex-[1.35]">
          <Label className="mb-2">{t.events.fieldDate}</Label>
          <DateField value={value.date} onChange={writable ? (v) => setStart({ date: v }) : undefined} />
        </div>
        <div className="min-w-0 flex-1">
          <Label className="mb-2">{t.events.fieldDoors}</Label>
          <TimeField value={value.time} onChange={writable ? (v) => setStart({ time: v }) : undefined} />
        </div>
      </div>

      {/* End time (optional, prefilled at doors + 6 h). Drives the
          Upcoming/Live/Past phase — a night with an end stays "Live" until it
          actually ends, then rolls to "Past". */}
      <div className="mb-[14px] flex gap-[10px]">
        <div className="min-w-0 flex-[1.35]">
          <Label className="mb-2">{t.events.fieldEndDate}</Label>
          <DateField value={value.endDate} anchor={value.date} onChange={writable ? setEndDate : undefined} />
        </div>
        <div className="min-w-0 flex-1">
          <Label className="mb-2">{t.events.fieldEnd}</Label>
          <TimeField value={value.endTime} onChange={writable ? setEndTime : undefined} />
        </div>
      </div>
    </>
  );
}
