'use client';

/**
 * Door check-in list (spec §4 + decision #39): search-first, big tap targets,
 * Beide/Onderweg/Ingecheckt toggle, live onderweg/binnen counters. Checked-in
 * guests stay visible but dim and, under "Beide", sink below an "AL BINNEN · N"
 * divider. Recreated from the prototype `Deur` screen using the shared kit.
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/po/icon';
import { Avatar, Label, PayChip, Scroll, StatusDot, Top } from '@/components/po/kit';
import { useDoor } from '../DoorProvider';
import type { DoorGuest } from '../model';
import { filterBySearch } from './fuzzy';
import { TierChip } from './TierChip';

const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';

type Filter = 'both' | 'wait' | 'in';

function Seg({ value, onChange }: { value: Filter; onChange: (v: Filter) => void }): JSX.Element {
  const items: [Filter, string][] = [
    ['both', 'Beide'],
    ['wait', 'Onderweg'],
    ['in', 'Ingecheckt'],
  ];
  return (
    <div className="flex flex-none gap-1.5 px-5 pb-[14px]">
      {items.map(([k, l]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={cn(
            'flex-1 cursor-pointer rounded-full border py-[9px] font-display text-[13px] font-bold transition-[filter] hover:brightness-[1.07]',
            value === k ? 'border-transparent bg-text text-bg' : 'border-line bg-transparent text-dim',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function CheckInList({ onOpenGuest, onAdd }: { onOpenGuest: (id: string) => void; onAdd: () => void }): JSX.Element {
  const { view, outboxByGuest } = useDoor();
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filter>('both');

  if (!view) return <ListSkeleton />;

  const matched = filterBySearch(view.guests, q);
  const waiting = matched.filter((g) => !g.inside);
  const checked = matched.filter((g) => g.inside);
  const flat = f === 'wait' ? waiting : f === 'in' ? checked : [...waiting, ...checked];
  const showDivider = f === 'both' && waiting.length > 0 && checked.length > 0;

  const row = (g: DoorGuest): JSX.Element => {
    const isDuplicate = (outboxByGuest.get(g.id) ?? []).some((e) => e.status === 'duplicate');
    // Inside but not all of their +N arrived yet → flag "nog N" so the doorhost
    // knows to re-open and top up (incremental check-in).
    const remaining = g.inside ? Math.max(0, g.plus - (g.arrived ?? 0)) : 0;
    return (
      <button
        key={g.id}
        type="button"
        onClick={() => onOpenGuest(g.id)}
        className={cn(
          'flex items-center gap-[13px] rounded-[16px] border p-[13px] text-left',
          cardPress,
          g.inside ? 'border-line2 bg-transparent opacity-[0.55]' : 'border-line bg-elev',
        )}
      >
        <Avatar name={g.name} size={46} accent={!g.inside && g.tierName === 'VIP'} />
        <div className="min-w-0 flex-1">
          <div className={cn('truncate font-display text-[17px] font-bold', g.inside ? 'text-dim' : 'text-text')}>
            {g.name}
            {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
          </div>
          <div className="mt-[5px] flex flex-wrap items-center gap-1.5">
            <TierChip name={g.tierName} color={g.tierColor} icon={g.tierIcon} />
            {g.pay && !g.inside && <PayChip pay="pay" />}
            {isDuplicate && (
              <span className="rounded-[6px] border border-dashed border-line px-[7px] py-[2px] font-body text-[10px] font-bold tracking-[0.03em] text-faint">
                DUPLICAAT
              </span>
            )}
          </div>
          <div className="mt-[5px] truncate font-body text-[11.5px] text-faint">
            door {g.addedByName}
            {g.last4 && ` · ••${g.last4}`}
          </div>
        </div>
        {g.inside ? (
          remaining > 0 ? (
            <span className="shrink-0 rounded-[8px] bg-acc-dim px-[9px] py-[5px] font-display text-[12px] font-bold text-acc">
              nog {remaining}
            </span>
          ) : (
            <StatusDot status="in" label={false} />
          )
        ) : (
          <span className="text-acc">
            <Icon name="chev" size={24} />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <Top
        big
        title="Check-in"
        sub={`${view.event.name}${view.event.venueName ? ` · ${view.event.venueName}` : ''}`}
      />
      <div className="flex flex-none gap-[10px] px-5 pb-[14px]">
        <div className="flex-1 rounded-[14px] border border-line bg-elev px-[14px] py-[12px]">
          <div className="font-display text-[26px] font-extrabold text-text">{view.waitingCount}</div>
          <div className="text-[12px] text-faint">onderweg</div>
        </div>
        <div className="flex-1 rounded-[14px] bg-acc-dim px-[14px] py-[12px]">
          <div className="font-display text-[26px] font-extrabold text-acc">{view.insideCount}</div>
          <div className="text-[12px] text-dim">binnen</div>
        </div>
      </div>
      <div className="flex-none px-5 pb-3">
        <div className="flex items-center gap-[11px] rounded-field border border-line bg-elev px-[15px] py-[13px]">
          <span className="text-faint">
            <Icon name="search" size={19} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Typ de naam van de gast…"
            autoFocus
            className="min-w-0 flex-1 border-none bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint"
          />
          <button
            type="button"
            onClick={onAdd}
            aria-label="Gast ter plekke toevoegen"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-text text-bg transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.94]"
          >
            <Icon name="plus" size={18} sw={2.4} />
          </button>
        </div>
      </div>
      <Seg value={f} onChange={setF} />
      <Scroll pad={20} bottom={100}>
        <Label className="mb-[10px]">
          {q
            ? `${flat.length} gevonden`
            : f === 'in'
              ? `${view.insideCount} ingecheckt`
              : f === 'wait'
                ? `${view.waitingCount} nog aan de deur`
                : 'Volgende aan de deur'}
        </Label>
        <div className="flex flex-col gap-[9px]">
          {(f === 'both' ? waiting : flat).map(row)}
          {showDivider && (
            <div className="mx-0.5 mb-0.5 mt-2 flex items-center gap-[10px]">
              <div className="h-px flex-1 bg-line2" />
              <span className="font-body text-[11px] font-bold tracking-[0.06em] text-ghost">AL BINNEN · {checked.length}</span>
              <div className="h-px flex-1 bg-line2" />
            </div>
          )}
          {f === 'both' && checked.map(row)}
          {flat.length === 0 && (
            <div className="py-[30px] text-center text-[14px] text-faint">
              {q ? 'Geen gast gevonden.' : f === 'in' ? 'Nog niemand ingecheckt.' : 'Iedereen is binnen 🎉'}
            </div>
          )}
        </div>
      </Scroll>
    </div>
  );
}

function ListSkeleton(): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <Top big title="Check-in" sub="Laden…" />
      <div className="px-5 pt-10 text-center text-[14px] text-faint">Gastenlijst laden…</div>
    </div>
  );
}
