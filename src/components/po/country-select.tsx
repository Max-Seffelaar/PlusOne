'use client';

/** Slick, searchable country picker for the landing phone field. Replaces the
 *  native <select> of react-phone-number-input: we drive the input-only build
 *  with an external `country` state, so the flag is ALWAYS the chosen country
 *  (no globe-while-typing) and the list matches the PLUSONE dark design.
 *  Country names are English (the app is English); search matches name, ISO
 *  code or dial code. */
import { type JSX, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { getCountries, getCountryCallingCode, type Country } from 'react-phone-number-input';
import flagComponents from 'react-phone-number-input/flags';
import enLabels from 'react-phone-number-input/locale/en.json';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Icon } from './icon';
import './landing-phone.css';

export type CountryCode = Country;

const flags = flagComponents as Record<string, ComponentType<{ title?: string }>>;
const names = enLabels as Record<string, string>;

function Flag({ code }: { code: string }): JSX.Element {
  const F = flags[code];
  return (
    <span className="po-flag">
      {F ? <F title={names[code] ?? code} /> : <Icon name="flag" size={12} className="text-faint" />}
    </span>
  );
}

interface Entry {
  code: CountryCode;
  name: string;
  dial: string;
}

export function CountrySelect({
  value,
  onChange,
}: {
  value: CountryCode;
  onChange: (c: CountryCode) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const all: Entry[] = useMemo(
    () =>
      getCountries()
        .map((c) => ({ code: c, name: names[c] ?? c, dial: getCountryCallingCode(c) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'en')),
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    const digits = q.replace(/\D/g, '');
    return all.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        (digits !== '' && c.dial.includes(digits)),
    );
  }, [all, query]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    searchRef.current?.focus();
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(code: CountryCode) {
    onChange(code);
    setOpen(false);
    setQuery('');
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t.shared.country.pickAria}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-[6px] rounded-[9px] px-[5px] py-[5px] text-text transition-[filter,background-color] hover:bg-elev2 active:scale-[0.97]"
      >
        <Flag code={value} />
        <span className="font-body text-[14px] font-semibold tabular-nums text-dim">
          +{getCountryCallingCode(value)}
        </span>
        <Icon name="chevD" size={15} className="text-faint" />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-[290px] overflow-hidden rounded-[16px] border border-line bg-elev2 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]">
          <div className="flex items-center gap-[9px] border-b border-line px-[13px] py-[11px]">
            <Icon name="search" size={16} className="text-faint" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.shared.country.searchPlaceholder}
              aria-label={t.shared.country.searchAria}
              // 16px: reachable from the /e request form's phone field, which
              // is on a pinch-zoomable page (publicRouteViewport) — a
              // sub-16px input there triggers iOS Safari's auto-zoom-on-focus.
              className="min-w-0 flex-1 border-none bg-transparent text-[16px] text-text outline-none placeholder:text-faint"
            />
          </div>
          <ul role="listbox" className="po-scroll max-h-[260px] overflow-y-auto py-[6px]">
            {filtered.map((c) => {
              const on = c.code === value;
              return (
                <li key={c.code} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onClick={() => pick(c.code)}
                    className={cn(
                      'flex w-full items-center gap-[11px] px-[13px] py-[9px] text-left transition-colors hover:bg-acc-dim',
                      on && 'bg-acc-dim',
                    )}
                  >
                    <Flag code={c.code} />
                    <span className="min-w-0 flex-1 truncate text-[14px] text-text">{c.name}</span>
                    <span className="font-body text-[13px] tabular-nums text-faint">+{c.dial}</span>
                    {on && <Icon name="check" size={15} stroke="#B5A6FF" sw={2.4} />}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-[13px] py-[14px] text-center text-[13px] text-faint">
                {t.shared.country.empty}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
