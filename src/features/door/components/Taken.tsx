'use client';

/**
 * Taken tab (decision #39): per-guest opdrachten, BELANGRIJK first, counters
 * open/belangrijk/klaar, filter Open/Klaar/Alle. The checkbox toggles the SAME
 * acknowledged status as the "Let op!" popup (note_acknowledged_*). Recreated
 * from the prototype `Taken` screen.
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/po/icon';
import { Avatar, Label, Scroll, Top } from '@/components/po/kit';
import { useDoor } from '../DoorProvider';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
type Filter = 'open' | 'done' | 'all';

function Seg({ value, onChange }: { value: Filter; onChange: (v: Filter) => void }): JSX.Element {
  const items: [Filter, string][] = [
    ['open', 'Open'],
    ['done', 'Klaar'],
    ['all', 'Alle'],
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

export function Taken({ onOpenGuest }: { onOpenGuest: (id: string) => void }): JSX.Element {
  const { tasks, ackNote } = useDoor();
  const [f, setF] = useState<Filter>('open');

  const openCount = tasks.filter((t) => !t.done).length;
  const highOpen = tasks.filter((t) => !t.done && t.high).length;
  const doneCount = tasks.length - openCount;

  const list = tasks
    .filter((t) => (f === 'open' ? !t.done : f === 'done' ? t.done : true))
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        (b.high ? 1 : 0) - (a.high ? 1 : 0) ||
        a.guest.name.localeCompare(b.guest.name),
    );

  return (
    <div className="flex h-full flex-col">
      <Top big title="Taken" sub="openstaande opdrachten aan de deur" />
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
          <div className="font-display text-[26px] font-extrabold text-text">{doneCount}</div>
          <div className="text-[12px] text-faint">klaar</div>
        </div>
      </div>
      <Seg value={f} onChange={setF} />
      <Scroll pad={20} bottom={100}>
        <div className="flex flex-col gap-[9px]">
          {list.map(({ guest, high, done }) => (
            <div
              key={guest.id}
              className={cn('flex items-start gap-[12px] rounded-[16px] border border-line bg-elev p-[14px]', done && 'opacity-[0.55]')}
              style={{ borderColor: high && !done ? 'rgba(181,166,255,0.4)' : undefined }}
            >
              <button
                type="button"
                onClick={() => ackNote(guest.id, !done)}
                className={cn(
                  'mt-px flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] border-2',
                  press,
                  done ? 'border-acc bg-acc' : 'border-ghost bg-transparent',
                )}
                aria-label={done ? 'Heropenen' : 'Markeer klaar'}
              >
                {done && <Icon name="check" size={15} stroke="#16132B" sw={3} />}
              </button>
              <button type="button" onClick={() => onOpenGuest(guest.id)} className="min-w-0 flex-1 cursor-pointer border-none bg-transparent p-0 text-left">
                <div className="mb-[5px] flex items-center gap-2">
                  {high && (
                    <span className="inline-flex items-center gap-1 rounded-[6px] bg-acc-dim px-[7px] py-0.5 font-body text-[10px] font-extrabold tracking-[0.04em] text-acc">
                      <Icon name="flag" size={10} stroke="#B5A6FF" fill="#B5A6FF" sw={2} />
                      BELANGRIJK
                    </span>
                  )}
                  <span className={cn('inline-flex items-center gap-[5px] font-body text-[11.5px] font-bold', guest.inside ? 'text-acc' : 'text-faint')}>
                    {guest.inside ? (
                      <>
                        <Icon name="check2" size={12} stroke="#B5A6FF" sw={2.4} />
                        binnen
                      </>
                    ) : (
                      'onderweg'
                    )}
                  </span>
                </div>
                <div className={cn('text-[15px] font-semibold leading-[1.4] text-text', done && 'line-through decoration-ghost')}>{guest.note}</div>
                <div className="mt-[7px] flex items-center gap-2">
                  <Avatar name={guest.name} size={22} />
                  <span className="text-[12.5px] text-faint">
                    {guest.name}
                    {guest.plus > 0 && ` · +${guest.plus}`}
                  </span>
                </div>
              </button>
            </div>
          ))}
          {list.length === 0 && (
            <div className="py-[36px] text-center text-[14.5px] text-faint">{f === 'open' ? 'Alles opgepakt 🎉' : 'Niets hier.'}</div>
          )}
          {tasks.length === 0 && f !== 'open' && <Label className="mt-2 text-center">Geen opdrachten voor dit event.</Label>}
        </div>
      </Scroll>
    </div>
  );
}
