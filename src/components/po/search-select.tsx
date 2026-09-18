'use client';

/** Kit-styled field primitive that lives beside `kit.tsx` rather than in it
 *  (like `datetime-field.tsx`), so the kit file stays under 800 lines. */
import { type JSX, useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Icon, type IconName } from './icon';
import { press } from './kit';

export interface SearchSelectOption {
  value: string;
  label: string;
  /** Faint right-aligned extra on the option row, e.g. an ISO code. */
  hint?: string;
}

/**
 * A Field-look button that opens a searchable option list below it (the venue
 * Country field, z8uq9m0hw2). Search matches the label or the value. A `value`
 * that is not one of the options is shown exactly as stored: never swapped for
 * a default, never rewritten, until the user picks an option. Without
 * `onChange` it renders read-only like a static Field. Closes on pick, Escape
 * or an outside tap; Enter in the search picks the first match. Pure client,
 * no portal and no media-query JS, so it behaves the same in a Capacitor
 * webview (#37). All copy comes from the caller's i18n surface.
 */
export function SearchSelect({
  value,
  options,
  onChange,
  label,
  icon,
  placeholder,
  searchPlaceholder,
  searchLabel,
  emptyText,
  className,
}: {
  value: string;
  options: readonly SearchSelectOption[];
  onChange?: (value: string) => void;
  /** Accessible name of the field, e.g. "Country" (read before the value). */
  label: string;
  icon?: IconName;
  placeholder?: string;
  searchPlaceholder: string;
  searchLabel: string;
  emptyText: string;
  className?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const shown = options.find((o) => o.value === value)?.label ?? value;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
    : options;

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
    searchRef.current?.focus();
    // The field can sit at the bottom of a scroll column: bring the list into view.
    panelRef.current?.scrollIntoView?.({ block: 'nearest' });
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(v: string): void {
    onChange?.(v);
    setOpen(false);
    setQuery('');
  }

  const shell = 'flex w-full items-center gap-[11px] rounded-field border bg-elev px-[15px] py-[13px] text-left';
  const iconEl = icon ? (
    <span className="text-faint">
      <Icon name={icon} size={19} />
    </span>
  ) : null;
  const valueEl = (
    <span className={cn('min-w-0 flex-1 truncate font-body text-[16px]', shown ? 'text-text' : 'text-faint')}>
      <span className="sr-only">{label}: </span>
      {shown || placeholder}
    </span>
  );

  if (!onChange) {
    return (
      <div className={cn(shell, 'border-line', className)}>
        {iconEl}
        {valueEl}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={cn(shell, press, open ? 'border-acc' : 'border-line')}
      >
        {iconEl}
        {valueEl}
        <Icon name="chevD" size={18} className={cn('text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          ref={panelRef}
          className="absolute inset-x-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-[16px] border border-line bg-elev2 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]"
        >
          <div className="flex items-center gap-[9px] border-b border-line px-[15px] py-[11px]">
            <Icon name="search" size={16} className="text-faint" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                const first = filtered[0];
                if (e.key === 'Enter' && first) {
                  e.preventDefault();
                  pick(first.value);
                }
              }}
              placeholder={searchPlaceholder}
              aria-label={searchLabel}
              aria-controls={listId}
              // 16px: below that iOS Safari zooms the page on focus.
              className="min-w-0 flex-1 border-none bg-transparent text-[16px] text-text outline-none placeholder:text-faint"
            />
          </div>
          <ul id={listId} role="listbox" aria-label={label} className="po-scroll max-h-[264px] overflow-y-auto py-[6px]">
            {filtered.map((o) => {
              const on = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={on}>
                  <button
                    type="button"
                    onClick={() => pick(o.value)}
                    className={cn(
                      'flex min-h-[44px] w-full items-center gap-[11px] px-[15px] py-[10px] text-left transition-colors hover:bg-acc-dim',
                      on && 'bg-acc-dim',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-[14.5px] text-text">{o.label}</span>
                    {o.hint && <span className="font-body text-[12.5px] tabular-nums text-faint">{o.hint}</span>}
                    {on && <Icon name="check" size={15} sw={2.4} className="text-acc" />}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && <li className="px-[15px] py-[14px] text-center text-[13px] text-faint">{emptyText}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
