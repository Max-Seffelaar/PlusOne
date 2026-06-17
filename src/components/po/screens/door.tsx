'use client';

/** Door mode: check-in list with Beide/Onderweg/Ingecheckt toggle + AL BINNEN
 *  divider; and the Taken tab (per-guest opdrachten, BELANGRIJK first). */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { guests } from '@/lib/po/data';
import type { Guest } from '@/lib/po/types';
import { useNav, usePo } from '../context';
import { Icon } from '../icon';
import { Avatar, Label, PayChip, RoleChip, Scroll, StatusDot, Top } from '../kit';

const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';
const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const col = 'flex h-full flex-col';

function Seg<T extends string>({ items, value, onChange }: { items: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }): JSX.Element {
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

// ── DEUR (tab) ───────────────────────────────────────────────────────────────
export function Deur(): JSX.Element {
  const nav = useNav();
  const { inside } = usePo();
  const [q, setQ] = useState('');
  const [f, setF] = useState<'both' | 'wait' | 'in'>('both');
  const gs = guests;
  const inn = gs.filter((g) => inside.has(g.id)).length;

  const base = q ? gs.filter((g) => g.name.toLowerCase().includes(q.toLowerCase())) : gs;
  const waiting = base.filter((g) => !inside.has(g.id));
  const checked = base.filter((g) => inside.has(g.id));
  const list = f === 'wait' ? waiting : f === 'in' ? checked : [...waiting, ...checked];
  const showDivider = f === 'both' && waiting.length > 0 && checked.length > 0;

  const guestRow = (g: Guest): JSX.Element => {
    const isIn = inside.has(g.id);
    return (
      <button
        key={g.id}
        type="button"
        onClick={() => nav.push('guest', { id: String(g.id) })}
        className={cn('flex items-center gap-[13px] rounded-[16px] border p-[13px] text-left', cardPress, isIn ? 'border-line2 bg-transparent opacity-[0.55]' : 'border-line bg-elev')}
      >
        <Avatar name={g.name} size={46} accent={!isIn && g.role === 'VIP'} />
        <div className="min-w-0 flex-1">
          <div className={cn('font-display text-[17px] font-bold', isIn ? 'text-dim' : 'text-text')}>
            {g.name}
            {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
          </div>
          <div className="mt-[5px] flex gap-1.5">
            <RoleChip role={g.role} />
            {g.pay === 'pay' && !isIn && <PayChip pay="pay" />}
          </div>
        </div>
        {isIn ? (
          <StatusDot status="in" />
        ) : (
          <span className="text-acc">
            <Icon name="chev" size={24} />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className={col}>
      <Top big title="Check-in" sub="FRENZY · De Marktkantine" />
      <div className="flex flex-none gap-[10px] px-5 pb-[14px]">
        <div className="flex-1 rounded-[14px] border border-line bg-elev px-[14px] py-[12px]">
          <div className="font-display text-[26px] font-extrabold text-text">{gs.length - inn}</div>
          <div className="text-[12px] text-faint">onderweg</div>
        </div>
        <div className="flex-1 rounded-[14px] bg-acc-dim px-[14px] py-[12px]">
          <div className="font-display text-[26px] font-extrabold text-acc">{inn}</div>
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
        </div>
      </div>
      <Seg items={[['both', 'Beide'], ['wait', 'Onderweg'], ['in', 'Ingecheckt']]} value={f} onChange={setF} />
      <Scroll pad={20} bottom={100}>
        <Label className="mb-[10px]">{q ? `${list.length} gevonden` : f === 'in' ? `${inn} ingecheckt` : f === 'wait' ? `${gs.length - inn} nog aan de deur` : 'Volgende aan de deur'}</Label>
        <div className="flex flex-col gap-[9px]">
          {(f === 'both' ? waiting : list).map(guestRow)}
          {showDivider && (
            <div className="mx-0.5 mb-0.5 mt-2 flex items-center gap-[10px]">
              <div className="h-px flex-1 bg-line2" />
              <span className="font-body text-[11px] font-bold tracking-[0.06em] text-ghost">AL BINNEN · {checked.length}</span>
              <div className="h-px flex-1 bg-line2" />
            </div>
          )}
          {f === 'both' && checked.map(guestRow)}
          {list.length === 0 && <div className="py-[30px] text-center text-[14px] text-faint">{f === 'in' ? 'Nog niemand ingecheckt.' : 'Iedereen is binnen 🎉'}</div>}
        </div>
      </Scroll>
    </div>
  );
}

// ── TAKEN (tab) ──────────────────────────────────────────────────────────────
export function Taken(): JSX.Element {
  const nav = useNav();
  const { inside, taskDone, ackTask } = usePo();
  const [f, setF] = useState<'open' | 'done' | 'all'>('open');
  const all = guests.filter((g) => g.note).map((g) => ({ g, prio: g.flag ?? 'low', done: taskDone(g.id) }));
  const openCount = all.filter((t) => !t.done).length;
  const highOpen = all.filter((t) => !t.done && t.prio === 'high').length;
  const list = all.filter((t) => (f === 'open' ? !t.done : f === 'done' ? t.done : true));
  list.sort((a, b) => Number(a.done) - Number(b.done) || (b.prio === 'high' ? 1 : 0) - (a.prio === 'high' ? 1 : 0) || a.g.id.localeCompare(b.g.id));

  return (
    <div className={col}>
      <Top big title="Taken" sub="FRENZY · openstaande opdrachten aan de deur" />
      <div className="flex flex-none gap-[10px] px-5 pb-[14px]">
        <div className="flex-1 rounded-[14px] bg-acc-dim px-[14px] py-[12px]">
          <div className="font-display text-[26px] font-extrabold text-acc">{openCount}</div>
          <div className="text-[12px] text-dim">open</div>
        </div>
        <div className="flex-1 rounded-[14px] border border-line bg-elev px-[14px] py-[12px]">
          <div className="flex items-center gap-1.5">
            <Icon name="flag" size={18} stroke="#B5A6FF" fill="#B5A6FF" />
            <div className="font-display text-[26px] font-extrabold text-text">{highOpen}</div>
          </div>
          <div className="text-[12px] text-faint">belangrijk</div>
        </div>
        <div className="flex-1 rounded-[14px] border border-line bg-elev px-[14px] py-[12px]">
          <div className="font-display text-[26px] font-extrabold text-text">{all.length - openCount}</div>
          <div className="text-[12px] text-faint">klaar</div>
        </div>
      </div>
      <Seg items={[['open', 'Open'], ['done', 'Klaar'], ['all', 'Alle']]} value={f} onChange={setF} />
      <Scroll pad={20} bottom={100}>
        <div className="flex flex-col gap-[9px]">
          {list.map(({ g, prio, done }) => {
            const isIn = inside.has(g.id);
            return (
              <div
                key={g.id}
                className={cn('flex items-start gap-[12px] rounded-[16px] border border-line bg-elev p-[14px]', done && 'opacity-[0.55]')}
                style={{ borderColor: prio === 'high' && !done ? 'rgba(181,166,255,0.4)' : undefined }}
              >
                <button
                  type="button"
                  onClick={() => ackTask(g.id, !done)}
                  className={cn('mt-px flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] border-2', press, done ? 'border-acc bg-acc' : 'border-ghost bg-transparent')}
                  aria-label={done ? 'Heropenen' : 'Markeer klaar'}
                >
                  {done && <Icon name="check" size={15} stroke="#16132B" sw={3} />}
                </button>
                <button type="button" onClick={() => nav.push('guest', { id: String(g.id) })} className="min-w-0 flex-1 cursor-pointer border-none bg-transparent p-0 text-left">
                  <div className="mb-[5px] flex items-center gap-2">
                    {prio === 'high' && (
                      <span className="inline-flex items-center gap-1 rounded-[6px] bg-acc-dim px-[7px] py-0.5 font-body text-[10px] font-extrabold tracking-[0.04em] text-acc">
                        <Icon name="flag" size={10} stroke="#B5A6FF" fill="#B5A6FF" sw={2} />
                        BELANGRIJK
                      </span>
                    )}
                    <span className={cn('inline-flex items-center gap-[5px] font-body text-[11.5px] font-bold', isIn ? 'text-acc' : 'text-faint')}>
                      {isIn ? (
                        <>
                          <Icon name="check2" size={12} stroke="#B5A6FF" sw={2.4} />
                          binnen
                        </>
                      ) : (
                        'onderweg'
                      )}
                    </span>
                  </div>
                  <div className={cn('text-[15px] font-semibold leading-[1.4] text-text', done && 'line-through decoration-ghost')}>{g.note}</div>
                  <div className="mt-[7px] flex items-center gap-2">
                    <Avatar name={g.name} size={22} />
                    <span className="text-[12.5px] text-faint">
                      {g.name}
                      {g.plus > 0 && ' · +' + g.plus}
                    </span>
                  </div>
                </button>
              </div>
            );
          })}
          {list.length === 0 && <div className="py-[36px] text-center text-[14.5px] text-faint">{f === 'open' ? 'Alles opgepakt 🎉' : 'Niets hier.'}</div>}
        </div>
      </Scroll>
    </div>
  );
}
