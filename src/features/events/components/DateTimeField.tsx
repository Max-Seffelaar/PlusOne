'use client';

import { useEffect, useRef, useState } from 'react';

// On-brand date + time picker (PLUSONE design). A drop-in for
// <input type="datetime-local">: `value`/`onChange` use the same local
// 'YYYY-MM-DDTHH:mm' string, so the wall-clock semantics (#26) are unchanged.
// Pure React + Tailwind — no browser-only date UI, so it works inside the native
// webview after the Capacitor wrap (#37).

interface Parts {
  y: number;
  mo: number; // 1-based
  d: number;
  h: number;
  mi: number;
}

const WEEKDAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,…,55
const monthFmt = new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' });
const triggerFmt = new Intl.DateTimeFormat('nl-NL', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const pad = (n: number) => String(n).padStart(2, '0');

function parseLocal(value: string): Parts | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}

function buildLocal(y: number, mo: number, d: number, h: number, mi: number): string {
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
}

function daysInMonth(y: number, mo: number): number {
  return new Date(y, mo, 0).getDate();
}

// Monday-first weekday index (0 = Monday) of the 1st of the month.
function firstWeekdayMon(y: number, mo: number): number {
  return (new Date(y, mo - 1, 1).getDay() + 6) % 7;
}

export function DateTimeField({
  value,
  onChange,
  placeholder = 'Kies datum en tijd',
  allowClear = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
}): JSX.Element {
  const parsed = parseLocal(value);
  const ref = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() =>
    parsed ? { y: parsed.y, mo: parsed.mo } : (() => {
      const t = new Date();
      return { y: t.getFullYear(), mo: t.getMonth() + 1 };
    })()
  );
  const [hour, setHour] = useState(parsed ? parsed.h : 23);
  const [minute, setMinute] = useState(parsed ? parsed.mi : 0);

  // Sync from an external value change (e.g. edit-form prefill).
  useEffect(() => {
    if (!parsed) return;
    setHour(parsed.h);
    setMinute(parsed.mi);
    setView({ y: parsed.y, mo: parsed.mo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function pickDay(d: number) {
    onChange(buildLocal(view.y, view.mo, d, hour, minute));
  }
  function changeHour(h: number) {
    setHour(h);
    if (parsed) onChange(buildLocal(parsed.y, parsed.mo, parsed.d, h, minute));
  }
  function changeMinute(mi: number) {
    setMinute(mi);
    if (parsed) onChange(buildLocal(parsed.y, parsed.mo, parsed.d, hour, mi));
  }
  function shiftMonth(delta: number) {
    setView((v) => {
      const idx = v.mo - 1 + delta;
      return { y: v.y + Math.floor(idx / 12), mo: ((idx % 12) + 12) % 12 + 1 };
    });
  }

  const today = new Date();
  const isToday = (d: number) =>
    today.getFullYear() === view.y && today.getMonth() + 1 === view.mo && today.getDate() === d;
  const isSelected = (d: number) =>
    parsed?.y === view.y && parsed?.mo === view.mo && parsed?.d === d;

  const triggerLabel = parsed
    ? `${triggerFmt.format(new Date(parsed.y, parsed.mo - 1, parsed.d))} · ${pad(parsed.h)}:${pad(parsed.mi)}`
    : placeholder;

  const lead = firstWeekdayMon(view.y, view.mo);
  const total = daysInMonth(view.y, view.mo);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`field flex w-full items-center justify-between text-left ${parsed ? 'text-text' : 'text-faint'}`}
      >
        <span>{triggerLabel}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-faint shrink-0" aria-hidden>
          <rect x="3" y="4.5" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 9h18M8 3v3M16 3v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="border-line bg-elev2 absolute left-0 z-20 mt-2 w-[19rem] rounded-card border p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} className="btn-ghost px-2 py-1 text-sm" aria-label="Vorige maand">
              ‹
            </button>
            <span className="font-display text-sm font-bold capitalize">
              {monthFmt.format(new Date(view.y, view.mo - 1, 1))}
            </span>
            <button type="button" onClick={() => shiftMonth(1)} className="btn-ghost px-2 py-1 text-sm" aria-label="Volgende maand">
              ›
            </button>
          </div>

          <div className="text-faint mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: lead }).map((_, i) => (
              <span key={`pad-${i}`} />
            ))}
            {Array.from({ length: total }, (_, i) => i + 1).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => pickDay(d)}
                className={`h-9 rounded-lg text-sm transition-colors ${
                  isSelected(d)
                    ? 'bg-acc text-on-acc font-bold'
                    : isToday(d)
                      ? 'border-acc text-text border'
                      : 'text-dim hover:bg-elev hover:text-text'
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          <div className="border-line2 mt-3 flex items-center gap-2 border-t pt-3">
            <span className="label">Tijd</span>
            <select
              className="field flex-1 py-1.5"
              value={hour}
              onChange={(e) => changeHour(Number(e.target.value))}
              aria-label="Uur"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {pad(h)}
                </option>
              ))}
            </select>
            <span className="text-faint">:</span>
            <select
              className="field flex-1 py-1.5"
              value={minute}
              onChange={(e) => changeMinute(Number(e.target.value))}
              aria-label="Minuut"
            >
              {MINUTES.map((mi) => (
                <option key={mi} value={mi}>
                  {pad(mi)}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 flex items-center justify-between">
            {allowClear && parsed ? (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className="btn-ghost text-acc-soft text-sm"
              >
                Wissen
              </button>
            ) : (
              <span />
            )}
            <button type="button" onClick={() => setOpen(false)} className="btn-primary text-sm">
              Klaar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
