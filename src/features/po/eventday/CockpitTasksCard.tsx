'use client';

/**
 * Tasks card for the desktop cockpit (G2 door-parity) — the desktop equivalent
 * of the door's `Taken.tsx`: guests with a note, priority-first then
 * open-before-done, with an acknowledge toggle. Reuses the door's copy
 * (`t.door.tasks*`/`taskMarkDone`/`taskReopen`/`taskPriorityBadge`) rather than
 * a parallel cockpit-only string set.
 */
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Icon } from '@/components/po/icon';
import { Avatar, Card, pressDesktop } from '@/components/po/kit';
import type { Guest } from '@/lib/po/types';

const press = pressDesktop;

export function CockpitTasksCard({
  guests,
  onAck,
}: {
  guests: Guest[];
  onAck: (guestId: string, ack: boolean) => void;
}): JSX.Element {
  // Refused guests carry no task, mirroring the door's Taken screen (built
  // from the non-refused `view.guests`, never `view.refused`).
  const tasks = guests.filter((g) => g.status !== 'refused' && g.note.trim().length > 0);
  const open = tasks.filter((g) => !g.noteAcknowledged);
  const priorityOpen = open.filter((g) => g.flag === 'high');
  const doneCount = tasks.length - open.length;

  const rows = [...tasks].sort(
    (a, b) =>
      Number(!!a.noteAcknowledged) - Number(!!b.noteAcknowledged) ||
      (b.flag === 'high' ? 1 : 0) - (a.flag === 'high' ? 1 : 0) ||
      a.name.localeCompare(b.name)
  );

  return (
    <Card className="p-[22px]">
      <div className="mb-1 font-display text-[17px] font-bold text-text">{t.door.tasksTitle}</div>
      <div className="mb-4 text-[12.5px] text-faint">{t.door.tasksSub}</div>

      {tasks.length > 0 && (
        <div className="mb-4 flex gap-[10px]">
          <div className="flex-1 rounded-[12px] bg-acc-dim px-[12px] py-[10px]">
            <div className="font-display text-[20px] font-extrabold text-acc">{open.length}</div>
            <div className="text-[11px] text-dim">{t.door.tasksStatOpen}</div>
          </div>
          <div className="flex-1 rounded-[12px] border border-line bg-elev2 px-[12px] py-[10px]">
            <div className="flex items-center gap-1.5">
              <Icon name="flag" size={14} stroke="#B5A6FF" fill="#B5A6FF" />
              <div className="font-display text-[20px] font-extrabold text-text">{priorityOpen.length}</div>
            </div>
            <div className="text-[11px] text-faint">{t.door.tasksStatPriority}</div>
          </div>
          <div className="flex-1 rounded-[12px] border border-line bg-elev2 px-[12px] py-[10px]">
            <div className="font-display text-[20px] font-extrabold text-text">{doneCount}</div>
            <div className="text-[11px] text-faint">{t.door.tasksStatDone}</div>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="py-2 text-center text-[13.5px] text-faint">{t.cockpit.tasksCardEmpty}</div>
      ) : (
        <div className="flex flex-col gap-[9px]">
          {rows.map((g) => {
            const done = !!g.noteAcknowledged;
            return (
              <div
                key={g.id}
                className={cn('flex items-start gap-[10px] rounded-[13px] border border-line bg-elev2 p-[11px]', done && 'opacity-[0.55]')}
                style={{ borderColor: g.flag === 'high' && !done ? 'rgba(181,166,255,0.4)' : undefined }}
              >
                <button
                  type="button"
                  onClick={() => onAck(g.id, !done)}
                  className={cn(
                    'mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border-2',
                    press,
                    done ? 'border-acc bg-acc' : 'border-ghost bg-transparent'
                  )}
                  aria-label={done ? t.door.taskReopen : t.door.taskMarkDone}
                >
                  {done && <Icon name="check" size={13} stroke="#16132B" sw={3} />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="mb-[3px] flex items-center gap-2">
                    {g.flag === 'high' && (
                      <span className="inline-flex items-center gap-1 rounded-[6px] bg-acc-dim px-[6px] py-0.5 font-body text-[9.5px] font-extrabold tracking-[0.04em] text-acc">
                        <Icon name="flag" size={9} stroke="#B5A6FF" fill="#B5A6FF" sw={2} />
                        {t.door.taskPriorityBadge}
                      </span>
                    )}
                    <Avatar name={g.name} size={18} />
                    <span className="truncate text-[12px] text-faint">{g.name}</span>
                  </div>
                  <div className={cn('text-[13.5px] font-semibold leading-[1.4] text-text', done && 'line-through decoration-ghost')}>
                    {g.note}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
