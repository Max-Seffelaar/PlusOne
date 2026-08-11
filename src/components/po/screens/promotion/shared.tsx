'use client';

/**
 * Small pieces shared across the Promotion area (G3): the event label/picker
 * used by both the Overview and Per-event tabs, and the section kicker. Anything
 * generic enough for other domains graduates to kit.tsx instead (TierPicker did).
 */
import { type JSX, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { PoEvent } from '@/lib/po/types';
import { Icon } from '../../icon';
import { pressDesktop } from '../../kit';

/** "FRENZY · 12 JUL" — the picker/overview event label (PoEvent carries no weekday). */
export function eventLabel(e: PoEvent): string {
  return `${e.name} · ${e.date} ${e.mon}`;
}

/** usePoEvents is newest-first, so the SOONEST upcoming event is the last one in
 *  the upcoming block — the default the Promotion tabs open on. */
export function soonestUpcoming(list: PoEvent[]): PoEvent | undefined {
  const upcoming = list.filter((e) => e.when === 'upcoming');
  return upcoming[upcoming.length - 1];
}

export function Kicker({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <div className={cn('font-body text-[11.5px] font-bold uppercase tracking-[0.07em] text-faint', className)}>
      {children}
    </div>
  );
}

export function EventPicker({
  events,
  selectedId,
  onPick,
}: {
  events: PoEvent[];
  selectedId: string | null;
  onPick: (id: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const selected = events.find((e) => e.id === selectedId) ?? null;
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t.promo.eventPickerAria}
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-[10px] whitespace-nowrap rounded-[13px] border border-line bg-elev2 px-[15px] py-[11px] font-display text-[14.5px] font-bold text-text',
          pressDesktop,
        )}
      >
        <Icon name="cal" size={16} stroke="#B5A6FF" />
        {selected ? eventLabel(selected) : '—'}
        <Icon name="chevD" size={16} className="text-ghost" />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-20 min-w-[250px] rounded-[14px] border border-line bg-elev p-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.55)]">
          {events.map((e) => {
            const on = e.id === selectedId;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  onPick(e.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-[9px] rounded-[9px] px-3 py-[11px] text-left font-body text-[13.5px] font-semibold',
                  on ? 'bg-acc-dim text-acc' : 'text-dim',
                  pressDesktop,
                )}
              >
                <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', on ? 'bg-acc' : 'bg-ghost')} />
                {eventLabel(e)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
