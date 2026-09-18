'use client';

/**
 * Token-styled react-day-picker for the date fields (T2, feedback 1/7).
 * Loaded lazily (next/dynamic in datetime-field.tsx) so the ~10 kB library never
 * lands in the /app First Load JS — it only loads when a calendar first opens.
 * Styling is fully via classNames (no react-day-picker stylesheet), matching the
 * dark kit: near-black surfaces, lavender accent, display font for the caption.
 *
 * ADE UX round (item C2): the caption is a month + year dropdown pair, so a date
 * five months out is two taps away instead of five clicks on the next arrow. The
 * range is deliberately narrow (last year through three years out) — an event
 * calendar never needs 1970. `month`/`onMonthChange` are controlled by the field
 * so typing a date moves the visible month with the keystroke.
 */
import type { JSX } from 'react';
import { DayPicker } from 'react-day-picker';

/** Selectable span: 1 Jan last year … 31 Dec three years out. */
export function dropdownRange(now = new Date()): { startMonth: Date; endMonth: Date } {
  const y = now.getFullYear();
  return { startMonth: new Date(y - 1, 0, 1), endMonth: new Date(y + 3, 11, 31) };
}

export function PoDayPicker({
  selected,
  onSelect,
  month,
  onMonthChange,
}: {
  selected?: Date;
  onSelect: (day: Date | undefined) => void;
  month?: Date;
  onMonthChange?: (m: Date) => void;
}): JSX.Element {
  const { startMonth, endMonth } = dropdownRange();
  return (
    <DayPicker
      mode="single"
      selected={selected}
      onSelect={onSelect}
      month={month}
      onMonthChange={onMonthChange}
      defaultMonth={month ?? selected}
      captionLayout="dropdown"
      startMonth={startMonth}
      endMonth={endMonth}
      weekStartsOn={1}
      showOutsideDays
      classNames={{
        root: 'select-none p-3',
        months: 'relative flex flex-col',
        month: 'w-full',
        nav: 'absolute right-0 top-0 flex items-center gap-1.5',
        button_previous:
          'flex h-[44px] w-[44px] cursor-pointer items-center justify-center rounded-[9px] border border-line bg-elev2 text-dim transition-[filter] hover:brightness-[1.25] disabled:pointer-events-none disabled:opacity-40 lg:h-[30px] lg:w-[30px]',
        button_next:
          'flex h-[44px] w-[44px] cursor-pointer items-center justify-center rounded-[9px] border border-line bg-elev2 text-dim transition-[filter] hover:brightness-[1.25] disabled:pointer-events-none disabled:opacity-40 lg:h-[30px] lg:w-[30px]',
        chevron: 'h-4 w-4 fill-current',
        // Caption: the dropdowns sit left, the prev/next arrows stay top-right.
        month_caption: 'flex h-[44px] items-center lg:h-[30px]',
        dropdowns: 'flex items-center gap-1.5',
        // The real <select> covers its label so the native picker opens on tap
        // (acceptable on touch, per the plan); the styled label is what you see.
        dropdown_root: 'relative inline-flex h-[44px] items-center lg:h-[30px]',
        dropdown:
          'absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none opacity-0 [&>option]:bg-elev2 [&>option]:text-text',
        caption_label:
          'pointer-events-none flex items-center gap-1 rounded-[9px] border border-line bg-elev2 px-[10px] py-[6px] font-display text-[14px] font-bold text-text',
        month_grid: 'mt-2 w-full border-collapse',
        weekday: 'pb-1.5 text-center font-body text-[11px] font-bold uppercase tracking-[0.04em] text-faint',
        day: 'p-[2px] text-center',
        day_button:
          'flex h-[40px] w-[40px] cursor-pointer items-center justify-center rounded-[10px] font-body text-[14px] text-text transition-colors hover:bg-white/[0.07] lg:h-[34px] lg:w-[34px] lg:text-[13.5px]',
        today: '[&>button]:font-bold [&>button]:text-acc',
        selected: '[&>button]:bg-acc [&>button]:font-bold [&>button]:text-bg [&>button]:hover:bg-acc',
        outside: 'opacity-35',
        disabled: 'opacity-25',
        hidden: 'invisible',
        focused: '[&>button]:outline [&>button]:outline-1 [&>button]:outline-acc',
      }}
    />
  );
}
