'use client';

/**
 * Responsive date/time fields (T2, feedback 1/7): the native pickers are fine on
 * mobile but clumsy with a mouse, so ≥1024px (the shell's desktop breakpoint)
 * the date field opens a react-day-picker calendar popover and the time field
 * becomes two compact selects. Below that everything stays the OS-native input.
 *
 * Value contracts match the native inputs so callers don't change:
 * DateField 'YYYY-MM-DD' | '', TimeField 'HH:mm' | ''. Omit onChange = read-only.
 * Capacitor-safe (#37): matchMedia is guarded and native inputs are the fallback.
 */
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Icon } from './icon';
import { Field, Spinner } from './kit';

// The calendar (react-day-picker) loads only when a popover first opens, so the
// library never lands in the /app First Load JS.
const PoDayPicker = dynamic(() => import('./daypicker').then((m) => m.PoDayPicker), {
  ssr: false,
  loading: () => (
    <div className="flex h-[300px] w-[286px] items-center justify-center">
      <Spinner />
    </div>
  ),
});

/** ≥1024px — matches the responsive shell's sidebar breakpoint. */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = (): void => setDesktop(mq.matches);
    update();
    // Older webviews only have the deprecated addListener — support both (#37).
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    }
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);
  return desktop;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → local Date (midnight), or undefined when empty/invalid. */
function parseYmd(s: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const toYmd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const dateLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

// Same surface as the kit Field, so the two variants are visually identical.
const fieldShell = 'flex items-center gap-[11px] rounded-field border border-line bg-elev px-[15px] py-[13px]';

// ── DateField ────────────────────────────────────────────────────────────────
export function DateField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange?: (v: string) => void;
  className?: string;
}): JSX.Element {
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape while the popover is open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!desktop) {
    return <Field icon="cal" type="date" value={value} onChange={onChange} className={className} />;
  }

  const selected = parseYmd(value);
  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={!onChange}
        onClick={() => setOpen((o) => !o)}
        aria-label={t.shared.datetime.dateAria}
        aria-expanded={open}
        className={cn(fieldShell, 'w-full text-left', onChange ? 'cursor-pointer transition-colors hover:border-white/[0.24]' : 'cursor-default', open && 'border-acc')}
      >
        <span className="text-faint">
          <Icon name="cal" size={19} />
        </span>
        <span className={cn('min-w-0 flex-1 truncate font-body text-[16px]', selected ? 'text-text' : 'text-faint')}>
          {selected ? dateLabel.format(selected) : t.shared.datetime.datePlaceholder}
        </span>
        {onChange && <Icon name="chev" size={16} className={cn('shrink-0 text-ghost transition-transform', open && 'rotate-90')} />}
      </button>
      {open && onChange && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 rounded-[16px] border border-line bg-elev shadow-[0_16px_40px_rgba(0,0,0,0.55)]">
          <PoDayPicker
            selected={selected}
            onSelect={(day) => {
              onChange(day ? toYmd(day) : '');
              setOpen(false);
            }}
          />
          <div className="flex items-center justify-between border-t border-line2 px-3 py-2">
            <button
              type="button"
              onClick={() => {
                onChange(toYmd(new Date()));
                setOpen(false);
              }}
              className="cursor-pointer rounded-[8px] px-2 py-1 font-display text-[12.5px] font-bold text-acc transition-[filter] hover:brightness-[1.2]"
            >
              {t.shared.datetime.today}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className="cursor-pointer rounded-[8px] px-2 py-1 font-display text-[12.5px] font-bold text-dim transition-[filter] hover:brightness-[1.2]"
              >
                {t.shared.datetime.clear}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── TimeField ────────────────────────────────────────────────────────────────
const HOURS = Array.from({ length: 24 }, (_, h) => pad(h));
const MINUTE_STEPS = Array.from({ length: 12 }, (_, i) => pad(i * 5));

const timeSelect =
  'cursor-pointer appearance-none rounded-[8px] bg-transparent py-0.5 text-center font-body text-[16px] text-text outline-none transition-colors hover:bg-white/[0.06] disabled:cursor-default disabled:hover:bg-transparent';

export function TimeField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange?: (v: string) => void;
  className?: string;
}): JSX.Element {
  const desktop = useIsDesktop();
  if (!desktop) {
    return <Field icon="clock" type="time" value={value} onChange={onChange} className={className} />;
  }

  const [hh = '', mm = ''] = value ? value.split(':') : ['', ''];
  // Keep an off-step minute (e.g. 23:38 doors) selectable instead of snapping it.
  const minutes = mm && !MINUTE_STEPS.includes(mm) ? [...MINUTE_STEPS, mm].sort() : MINUTE_STEPS;
  const commit = (h: string, m: string): void => {
    if (!onChange) return;
    if (h === '' && m === '') {
      onChange('');
      return;
    }
    onChange(`${h || '00'}:${m || '00'}`);
  };

  return (
    <div className={cn(fieldShell, className)} style={{ colorScheme: 'dark' }}>
      <span className="text-faint">
        <Icon name="clock" size={19} />
      </span>
      <select
        value={hh}
        disabled={!onChange}
        onChange={(e) => commit(e.target.value, e.target.value === '' ? '' : mm)}
        aria-label={t.shared.datetime.hourAria}
        className={timeSelect}
      >
        <option value="">{t.shared.datetime.emptyTime}</option>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="font-body text-[16px] text-faint">:</span>
      <select
        value={mm}
        disabled={!onChange}
        onChange={(e) => commit(hh, e.target.value)}
        aria-label={t.shared.datetime.minuteAria}
        className={timeSelect}
      >
        <option value="">{t.shared.datetime.emptyTime}</option>
        {minutes.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
