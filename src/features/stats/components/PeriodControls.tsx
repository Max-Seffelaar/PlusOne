'use client';

// Period controls for the venue overview — presets + explicit from/to dates.
// Each change rewrites the URL (?from&to) and the server re-aggregates over that
// window. Preset dates are computed in the click handler (never during render),
// so there is no hydration mismatch.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@/lib/utils';

const PRESETS: [string, number | null][] = [
  ['30 days', 30],
  ['3 months', 90],
  ['12 months', 365],
  ['All', null],
];

export function PeriodControls({
  from,
  to,
}: {
  from: string | null;
  to: string | null;
}): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function push(nextFrom: string | null, nextTo: string | null): void {
    const next = new URLSearchParams(params.toString());
    if (nextFrom) next.set('from', nextFrom); else next.delete('from');
    if (nextTo) next.set('to', nextTo); else next.delete('to');
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  function applyPreset(days: number | null): void {
    if (days == null) return push(null, null);
    const d = new Date();
    d.setDate(d.getDate() - days);
    push(d.toISOString().slice(0, 10), null);
  }

  const inputClass =
    'rounded-[11px] border border-line bg-elev px-[12px] py-[8px] text-[13px] text-text outline-none [color-scheme:dark]';

  // A preset is "active" when from = today-Ndays (matched loosely on the day).
  const activeDays = (() => {
    if (!from && !to) return null as number | null | undefined;
    return undefined; // custom
  })();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map(([label, days]) => {
        const on = days === null ? activeDays === null : false;
        return (
          <button
            key={label}
            type="button"
            onClick={() => applyPreset(days)}
            className={cn(
              'cursor-pointer rounded-full border px-[13px] py-1.5 font-display text-[12.5px] font-bold transition-[filter] hover:brightness-[1.08]',
              on ? 'border-transparent bg-text text-bg' : 'border-line bg-transparent text-dim'
            )}
          >
            {label}
          </button>
        );
      })}
      <div className="flex-1" />
      <label className="flex items-center gap-1.5 text-[12px] text-faint">
        From
        <input
          type="date"
          value={from ?? ''}
          onChange={(e) => push(e.target.value || null, to)}
          className={inputClass}
        />
      </label>
      <label className="flex items-center gap-1.5 text-[12px] text-faint">
        To
        <input
          type="date"
          value={to ?? ''}
          onChange={(e) => push(from, e.target.value || null)}
          className={inputClass}
        />
      </label>
    </div>
  );
}
