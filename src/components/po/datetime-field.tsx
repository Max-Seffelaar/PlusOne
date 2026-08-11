'use client';

/**
 * Date/time fields for the event form (T2, feedback 1/7 + retest 3/7).
 *
 * DateField — ALL viewports open the styled react-day-picker popover on a
 * whole-field tap (retest: the native Android/desktop pickers were off-brand and
 * only opened from the tiny icon). Desktop additionally allows TYPING the date
 * (dd-mm-yyyy and friends); on touch viewports the input is readOnly so the tap
 * opens the calendar without popping the keyboard.
 *
 * TimeField — mobile keeps the native OS wheel (good on touch); desktop is a
 * typeable HH:mm input plus a kit-styled dropdown of half-hour suggestions (the
 * native <select> popup rendered as an unstylable white sliver — retest Q5).
 *
 * Value contracts match the native inputs so callers don't change:
 * DateField 'YYYY-MM-DD' | '', TimeField 'HH:mm' | ''. Omit onChange = read-only.
 * Capacitor-safe (#37): guarded matchMedia, no browser-only API without fallback.
 */
import { type JSX, useEffect, useRef, useState } from 'react';
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
    // window resize as a fallback: emulated viewports (DevTools device mode,
    // some webviews) reflow without firing the media-query change event.
    window.addEventListener('resize', update);
    // Older webviews only have the deprecated addListener — support both (#37).
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update);
      return () => {
        window.removeEventListener('resize', update);
        mq.removeEventListener('change', update);
      };
    }
    mq.addListener(update);
    return () => {
      window.removeEventListener('resize', update);
      mq.removeListener(update);
    };
  }, []);
  return desktop;
}

/** Close-on-outside-click + Escape for a popover anchored inside `ref`. */
function useDismiss(ref: React.RefObject<HTMLElement>, open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, close]);
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

/** Typed date → 'YYYY-MM-DD'. Accepts 16-07-2026, 16/7/26, 16.7 (current year),
 *  and the ISO form. Returns '' for blank, null when it can't be read. */
export function parseTypedDate(raw: string, now = new Date()): string | null {
  const s = raw.trim();
  if (!s) return '';
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const dmy = /^(\d{1,2})[-/. ](\d{1,2})(?:[-/. ](\d{2,4}))?$/.exec(s);
  let y: number, mo: number, d: number;
  if (iso) {
    y = Number(iso[1]);
    mo = Number(iso[2]);
    d = Number(iso[3]);
  } else if (dmy) {
    d = Number(dmy[1]);
    mo = Number(dmy[2]);
    y = dmy[3] ? Number(dmy[3]) : now.getFullYear();
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d);
  // Reject rollovers like 31-02 → 03-03.
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return toYmd(date);
}

/** Typed time → 'HH:mm'. Accepts 23:00, 23.00, 2300, 23, 9:5.
 *  Returns '' for blank, null when it can't be read. */
export function parseTypedTime(raw: string): string | null {
  const s = raw.trim().replace(/[.,;hH]/g, ':');
  if (!s) return '';
  let h: number, m: number;
  if (/^\d{1,2}$/.test(s)) {
    h = Number(s);
    m = 0;
  } else if (/^\d{3,4}$/.test(s)) {
    h = Number(s.slice(0, -2));
    m = Number(s.slice(-2));
  } else {
    const mm = /^(\d{1,2}):(\d{0,2})$/.exec(s);
    if (!mm) return null;
    h = Number(mm[1]);
    m = mm[2] ? Number(mm[2]) : 0;
  }
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

const dateLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
// Narrow viewports drop the weekday — "16 Jul 2026" keeps the field compact
// beside the time column (retest 3/7: the row overflowed on phones).
const dateLabelShort = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// Same surface as the kit Field, so the variants are visually identical.
const fieldShell = 'flex items-center gap-[11px] rounded-field border border-line bg-elev px-[15px] py-[13px]';
const popShell = 'absolute left-0 top-[calc(100%+8px)] z-50 rounded-[16px] border border-line bg-elev shadow-[0_16px_40px_rgba(0,0,0,0.55)]';

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
  // Editing buffer while the user types; null = show the formatted value.
  const [text, setText] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitText = (): void => {
    if (text === null || !onChange) return;
    const parsed = parseTypedDate(text);
    if (parsed !== null) onChange(parsed);
    setText(null); // invalid input reverts to the last valid value
  };

  useDismiss(wrapRef, open, () => {
    setOpen(false);
    commitText();
  });

  const selected = parseYmd(value);

  const openPicker = (): void => {
    if (!onChange) return;
    setOpen(true);
    inputRef.current?.focus();
  };

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      {/* Whole-field tap opens the calendar (retest Q7) — not just the icon. */}
      <div
        onClick={openPicker}
        className={cn(fieldShell, onChange ? 'cursor-pointer transition-colors hover:border-white/[0.24]' : 'cursor-default', open && 'border-acc')}
      >
        <span className="text-faint">
          <Icon name="cal" size={19} />
        </span>
        <input
          ref={inputRef}
          value={text ?? (selected ? (desktop ? dateLabel : dateLabelShort).format(selected) : '')}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => onChange && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitText();
              setOpen(false);
            }
          }}
          // Touch viewports: readOnly keeps the keyboard away — the tap is for the
          // calendar. Desktop: type 16-07-2026 (or pick) as you prefer.
          readOnly={!onChange || !desktop}
          placeholder={t.shared.datetime.datePlaceholder}
          aria-label={t.shared.datetime.dateAria}
          role="combobox"
          aria-expanded={open}
          className={cn(
            'min-w-0 flex-1 border-none bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint',
            onChange && 'cursor-pointer focus:cursor-text',
          )}
        />
        {/* The chevron only fits comfortably on desktop; on phones the calendar
            icon already signals the affordance and every px of width counts. */}
        {onChange && desktop && <Icon name="chev" size={16} className={cn('shrink-0 text-ghost transition-transform', open && 'rotate-90')} />}
      </div>
      {open && onChange && (
        <>
          {/* On small screens an anchored popover can overflow the viewport, so
              the calendar centers as an overlay with a dimmed backdrop instead. */}
          {!desktop && <div className="fixed inset-0 z-40 bg-[rgba(6,6,8,0.6)] backdrop-blur-[2px]" onClick={() => setOpen(false)} />}
          <div
            className={cn(
              'z-50 rounded-[16px] border border-line bg-elev shadow-[0_16px_40px_rgba(0,0,0,0.55)]',
              desktop ? 'absolute left-0 top-[calc(100%+8px)]' : 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            )}
          >
            <PoDayPicker
            selected={selected}
            onSelect={(day) => {
              setText(null);
              onChange(day ? toYmd(day) : '');
              setOpen(false);
            }}
          />
          <div className="flex items-center justify-between border-t border-line2 px-3 py-2">
            <button
              type="button"
              onClick={() => {
                setText(null);
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
                  setText(null);
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
        </>
      )}
    </div>
  );
}

// ── TimeField ────────────────────────────────────────────────────────────────
// Half-hour suggestions; typing covers everything in between.
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`);

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
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commitText = (): void => {
    if (text === null || !onChange) return;
    const parsed = parseTypedTime(text);
    if (parsed !== null) onChange(parsed);
    setText(null);
  };

  useDismiss(wrapRef, open, () => {
    setOpen(false);
    commitText();
  });

  // Scroll the suggestion list to the current (or a sensible evening) time.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const target = value || '22:00';
    const idx = TIME_OPTIONS.findIndex((o) => o >= target);
    const el = listRef.current.children[Math.max(0, idx)] as HTMLElement | undefined;
    if (el) listRef.current.scrollTop = Math.max(0, el.offsetTop - 72);
  }, [open, value]);

  if (!desktop) {
    return <Field icon="clock" type="time" value={value} onChange={onChange} className={className} />;
  }

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <div
        onClick={() => {
          if (!onChange) return;
          setOpen(true);
          inputRef.current?.focus();
        }}
        className={cn(fieldShell, onChange ? 'cursor-pointer transition-colors hover:border-white/[0.24]' : 'cursor-default', open && 'border-acc')}
      >
        <span className="text-faint">
          <Icon name="clock" size={19} />
        </span>
        <input
          ref={inputRef}
          value={text ?? value}
          onChange={(e) => setText(e.target.value.replace(/[^\d:.,;hH]/g, '').slice(0, 5))}
          onFocus={() => onChange && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitText();
              setOpen(false);
            }
          }}
          readOnly={!onChange}
          placeholder={t.shared.datetime.emptyTime}
          aria-label={t.shared.datetime.hourAria}
          role="combobox"
          aria-expanded={open}
          inputMode="numeric"
          className="min-w-0 flex-1 border-none bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint"
        />
        {onChange && <Icon name="chevD" size={16} className={cn('shrink-0 text-ghost transition-transform', open && 'rotate-180')} />}
      </div>
      {open && onChange && (
        <div className={cn(popShell, 'w-full min-w-[110px] p-1.5')}>
          <div ref={listRef} className="max-h-[228px] overflow-y-auto">
            {TIME_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  setText(null);
                  onChange(opt);
                  setOpen(false);
                }}
                className={cn(
                  'block w-full cursor-pointer rounded-[9px] px-3 py-[7px] text-left font-body text-[14.5px] transition-colors hover:bg-white/[0.07]',
                  value === opt ? 'bg-acc-dim font-bold text-acc' : 'text-text',
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
