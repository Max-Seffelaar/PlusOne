'use client';

/**
 * Guest detail (decision #39): logboek (toegevoegd door/wanneer, +N, ingecheckt
 * hoe laat/door wie — built from guests/check_ins, never audit_log), stepper
 * check-in "Check in · N personen", refuse flow with a mandatory reason (#10),
 * and the "Let op!" popup for high-priority notes. Recreated from the prototype
 * `Guest` screen. Check-ins are append-only, so there is no "uitchecken".
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Icon, type IconName } from '@/components/po/icon';
import { Avatar, Btn, IconBtn, Label, PayChip, Scroll, Stepper, Top } from '@/components/po/kit';
import { BottomBar, Sheet } from '@/components/po/shell';
import { useDoor } from '../DoorProvider';
import { TierChip } from './TierChip';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';

function LogRow({
  icon,
  label,
  who,
  when,
  accent,
  last,
}: {
  icon: IconName;
  label: string;
  who: string;
  when?: string;
  accent?: boolean;
  last?: boolean;
}): JSX.Element {
  return (
    <div className={cn('flex items-center gap-[12px] py-[12px]', last ? '' : 'border-b border-line2')}>
      <span className={cn('flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]', accent ? 'bg-acc-dim text-acc' : 'bg-elev2 text-dim')}>
        <Icon name={icon} size={15} sw={2} />
      </span>
      <span className="flex-1 text-[13.5px] text-faint">{label}</span>
      <span className="text-right">
        <span className={cn('text-[13.5px] font-semibold', accent ? 'text-acc' : 'text-text')}>{who}</span>
        {when && <span className="ml-[7px] font-display text-[12px] text-faint">{when}</span>}
      </span>
    </div>
  );
}

export function GuestDetail({ guestId, onBack }: { guestId: string; onBack: () => void }): JSX.Element | null {
  const { guestById, checkIn, refuse, ackNote } = useDoor();
  const g = guestById(guestId);
  const [plus, setPlus] = useState(g?.plus ?? 0);
  const [alertOpen, setAlertOpen] = useState(g?.notePriority === 'high' && !g?.acknowledged);
  const [refuseOpen, setRefuseOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!g) return null;
  const total = 1 + plus;
  const hasTask = !!g.note;
  const done = g.acknowledged;

  return (
    <div className="flex h-full flex-col">
      <Top
        onBack={onBack}
        title="Gast"
        right={
          <>
            <IconBtn name="share" />
            <IconBtn name="dots" />
          </>
        }
      />
      <Scroll bottom={20}>
        <div className="flex flex-col items-center px-0 pb-[18px] pt-1.5 text-center">
          <Avatar name={g.name} size={84} accent={g.tierName === 'VIP'} />
          <h2 className="mb-0 mt-4 whitespace-nowrap font-display text-[28px] font-extrabold tracking-[-0.02em] text-text">{g.name}</h2>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-[7px]">
            <TierChip name={g.tierName} color={g.tierColor} icon={g.tierIcon} />
            {g.pay && <PayChip pay="pay" />}
          </div>
        </div>

        {hasTask && (
          <div className={cn('mb-[10px] rounded-[14px] p-[14px]', g.notePriority === 'high' && !done ? 'border border-transparent bg-acc-dim' : 'border border-line bg-elev')}>
            <div className="mb-[7px] flex items-center justify-between">
              <span className="inline-flex items-center gap-[7px]">
                <Icon name="flag" size={15} stroke={g.notePriority === 'high' ? '#B5A6FF' : 'rgba(255,255,255,0.40)'} fill={g.notePriority === 'high' ? '#B5A6FF' : 'none'} />
                <Label className={g.notePriority === 'high' ? 'text-acc-soft' : 'text-faint'}>{g.notePriority === 'high' ? 'Belangrijke opdracht' : 'Opdracht'}</Label>
              </span>
              {done ? (
                <span className="inline-flex items-center gap-[5px] font-body text-[11.5px] font-bold text-acc">
                  <Icon name="check2" size={13} stroke="#B5A6FF" sw={2.4} />
                  Opgepakt{g.ackByName ? ` · ${g.ackByName}` : ''}
                </span>
              ) : (
                <span className="font-body text-[11px] font-bold text-faint">OPEN</span>
              )}
            </div>
            <div className="mb-3 text-[15px] leading-[1.45] text-text">{g.note}</div>
            <Btn sm full kind={done ? 'ghost' : 'primary'} icon={done ? 'history' : 'check2'} onClick={() => ackNote(g.id, !done)}>
              {done ? 'Heropenen' : 'Markeer als opgepakt'}
            </Btn>
          </div>
        )}

        {g.pay && (
          <div className="mb-[10px] flex items-center gap-[9px] rounded-[13px] border border-dashed border-line bg-elev px-[14px] py-[11px]">
            <Icon name="money" size={17} className="text-text" />
            <span className="text-[13.5px] font-semibold text-text">Betaalde gastenlijst — laat afrekenen aan de deur</span>
          </div>
        )}

        <Label className="mx-0.5 mb-[10px] mt-1.5">Logboek</Label>
        <div className="mb-4 rounded-[14px] border border-line bg-elev px-[14px] py-1">
          <LogRow icon="user" label="Toegevoegd" who={g.addedByName} when={g.addedAt} />
          {g.plus > 0 && <LogRow icon="users" label="Meegenomen gasten" who={`+${g.plus} tickets`} />}
          {g.inside ? (
            <LogRow icon="check2" label={g.arrived && g.arrived > 0 ? `Ingecheckt · +${g.arrived}` : 'Ingecheckt'} who={g.inByName ?? 'Deur'} when={g.inAt} accent last />
          ) : (
            <LogRow icon="clock" label="Nog niet ingecheckt" who="onderweg" last />
          )}
        </div>

        {!g.inside && (
          <>
            <Label className="mb-[9px]">Hoeveel komen er binnen?</Label>
            <div className="mb-4">
              <Stepper value={plus + 1} onChange={(v) => setPlus(Math.max(0, v - 1))} />
            </div>
            <Btn kind="ghost" full icon="close" onClick={() => setRefuseOpen(true)}>
              Weigeren
            </Btn>
          </>
        )}
      </Scroll>

      <BottomBar>
        {g.inside ? (
          <div className="flex items-center justify-center gap-[8px] py-[6px] font-display text-[15px] font-bold text-acc">
            <Icon name="check2" size={18} stroke="#B5A6FF" sw={2.4} />
            Binnen{g.inAt ? ` om ${g.inAt}` : ''}
            {g.inByName ? <span className="font-body text-[12.5px] font-semibold text-faint">· door {g.inByName}</span> : null}
          </div>
        ) : (
          <Btn
            kind="primary"
            full
            icon="check"
            onClick={() => {
              checkIn(g.id, total);
              onBack();
            }}
          >
            Check in · {total} {total === 1 ? 'persoon' : 'personen'}
          </Btn>
        )}
      </BottomBar>

      {refuseOpen && (
        <Sheet onClose={() => setRefuseOpen(false)} center={false}>
          <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">Gast weigeren</div>
          <div className="mb-4 text-[13px] text-faint">Reden is verplicht — komt in het logboek.</div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoFocus
            placeholder="bv. niet op de lijst, agressief gedrag…"
            className="mb-4 w-full resize-none rounded-[14px] border border-line bg-bg p-[14px] font-body text-[15px] leading-[1.5] text-text outline-none placeholder:text-faint"
          />
          <Btn
            full
            kind="primary"
            icon="close"
            disabled={reason.trim().length === 0}
            className={reason.trim().length === 0 ? 'opacity-[0.45]' : ''}
            onClick={() => {
              refuse(g.id, reason.trim());
              setRefuseOpen(false);
              onBack();
            }}
          >
            Weiger {g.name}
          </Btn>
          <button type="button" onClick={() => setRefuseOpen(false)} className={cn('mt-[10px] cursor-pointer border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
            Annuleren
          </button>
        </Sheet>
      )}

      {alertOpen && (
        <Sheet onClose={() => setAlertOpen(false)} center>
          <div className="mb-[14px] flex h-[52px] w-[52px] items-center justify-center rounded-[16px] bg-acc">
            <Icon name="warn" size={28} stroke="#16132B" sw={2.2} />
          </div>
          <div className="font-display text-[22px] font-extrabold tracking-[-0.01em] text-text">Let op!</div>
          <div className="mb-[14px] mt-0.5 text-[13px] text-faint">Opdracht voor {g.name}</div>
          <div className="mb-[18px] w-full rounded-[14px] border border-line bg-elev p-[14px] text-left text-[15.5px] leading-[1.45] text-text">{g.note}</div>
          <Btn
            full
            kind="primary"
            icon="check2"
            onClick={() => {
              ackNote(g.id, true);
              setAlertOpen(false);
            }}
          >
            Gezien &amp; opgepakt
          </Btn>
          <button type="button" onClick={() => setAlertOpen(false)} className={cn('mt-[10px] cursor-pointer border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
            Later
          </button>
        </Sheet>
      )}
    </div>
  );
}
