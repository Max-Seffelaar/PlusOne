'use client';

/**
 * Token-styled react-day-picker for the desktop date field (T2, feedback 1/7).
 * Loaded lazily (next/dynamic in datetime-field.tsx) so the ~10 kB library never
 * lands in the /app First Load JS — it only loads when a calendar first opens.
 * Styling is fully via classNames (no react-day-picker stylesheet), matching the
 * dark kit: near-black surfaces, lavender accent, display font for the caption.
 */
import { DayPicker } from 'react-day-picker';

export function PoDayPicker({
  selected,
  onSelect,
}: {
  selected?: Date;
  onSelect: (day: Date | undefined) => void;
}): JSX.Element {
  return (
    <DayPicker
      mode="single"
      selected={selected}
      onSelect={onSelect}
      defaultMonth={selected}
      weekStartsOn={1}
      showOutsideDays
      classNames={{
        root: 'select-none p-3',
        months: 'relative flex flex-col',
        month: 'w-full',
        nav: 'absolute right-0 top-0 flex items-center gap-1.5',
        button_previous:
          'flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-[9px] border border-line bg-elev2 text-dim transition-[filter] hover:brightness-[1.25] disabled:pointer-events-none disabled:opacity-40',
        button_next:
          'flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-[9px] border border-line bg-elev2 text-dim transition-[filter] hover:brightness-[1.25] disabled:pointer-events-none disabled:opacity-40',
        chevron: 'h-4 w-4 fill-current',
        month_caption: 'flex h-[30px] items-center px-1 font-display text-[14.5px] font-bold text-text',
        month_grid: 'mt-2 w-full border-collapse',
        weekday: 'pb-1.5 text-center font-body text-[11px] font-bold uppercase tracking-[0.04em] text-faint',
        day: 'p-[2px] text-center',
        day_button:
          'flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-[10px] font-body text-[13.5px] text-text transition-colors hover:bg-white/[0.07]',
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
