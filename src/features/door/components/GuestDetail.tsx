'use client';

/**
 * Guest detail (decision #39): logboek (toegevoegd door/wanneer, +N, ingecheckt
 * hoe laat/door wie — built from guests/check_ins, never audit_log), stepper
 * check-in "Check in · N personen", refuse flow with a mandatory reason (#10),
 * and the "Let op!" popup for high-priority notes. Recreated from the prototype
 * `Guest` screen. A guest already inside can be topped up ("nog inchecken") when
 * not all of their +N have arrived yet (plus_ones_arrived only rises), or have
 * their check-in undone ("terugdraaien", soft void #3) and later re-checked in.
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { Icon, type IconName } from '@/components/po/icon';
import { Avatar, Btn, IconBtn, Label, PayChip, Scroll, Stepper, Top, press } from '@/components/po/kit';
import { BottomBar, Sheet } from '@/components/po/shell';
import { useDoor } from '../DoorProvider';
import { tierRole } from '../model';
import { TierChip } from './TierChip';

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
  const { guestById, checkIn, topUp, voidCheckIn, reviveCheckIn, refuse, ackNote, allowUncheck } = useDoor();
  const g = guestById(guestId);
  // Start the door check-in at just the named guest (1 person), NOT the whole
  // party: arrivals are staggered (#25), so the host bumps the stepper for any
  // +N actually present now and tops up the rest later via "nog inchecken".
  // Defaulting to the full party silently checked everyone in, leaving late
  // arrivals un-addable (only "uitchecken" remained) — the reported bug.
  const [plus, setPlus] = useState(0);
  const [addNow, setAddNow] = useState(1);
  const [alertOpen, setAlertOpen] = useState(g?.notePriority === 'high' && !g?.acknowledged);
  const [refuseOpen, setRefuseOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!g) return null;
  const total = 1 + plus;
  // Already inside but not all of their +N have arrived → offer "nog inchecken".
  const remaining = g.inside ? Math.max(0, g.plus - (g.arrived ?? 0)) : 0;
  const addClamped = Math.min(remaining, Math.max(1, addNow));
  const hasTask = !!g.note;
  const done = g.acknowledged;

  return (
    <div className="flex h-full flex-col">
      <Top
        onBack={onBack}
        title={t.door.guestTitle}
        right={
          <>
            <IconBtn name="share" />
            <IconBtn name="dots" />
          </>
        }
      />
      <Scroll bottom={20}>
        <div className="flex flex-col items-center px-0 pb-[18px] pt-1.5 text-center">
          {/* tierName is the real tier name now — vip-ness for the accent ring
              comes from the tierRole taxonomy ("VIP + fles op tafel" counts). */}
          <Avatar name={g.name} size={84} accent={tierRole(g.tierName).label === 'VIP'} />
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
                <Label className={g.notePriority === 'high' ? 'text-acc-soft' : 'text-faint'}>{g.notePriority === 'high' ? t.door.taskPriorityHigh : t.door.taskPriorityNormal}</Label>
              </span>
              {done ? (
                <span className="inline-flex items-center gap-[5px] font-body text-[11.5px] font-bold text-acc">
                  <Icon name="check2" size={13} stroke="#B5A6FF" sw={2.4} />
                  {g.ackByName ? fmt(t.door.taskDoneBy, { name: g.ackByName }) : t.door.taskStatusDone}
                </span>
              ) : (
                <span className="font-body text-[11px] font-bold text-faint">{t.door.taskStatusOpen}</span>
              )}
            </div>
            <div className="mb-3 text-[15px] leading-[1.45] text-text">{g.note}</div>
            <Btn sm full kind={done ? 'ghost' : 'primary'} icon={done ? 'history' : 'check2'} onClick={() => ackNote(g.id, !done)}>
              {done ? t.door.taskReopen : t.door.taskMarkDone}
            </Btn>
          </div>
        )}

        {g.pay && (
          <div className="mb-[10px] flex items-center gap-[9px] rounded-[13px] border border-dashed border-line bg-elev px-[14px] py-[11px]">
            <Icon name="money" size={17} className="text-text" />
            <span className="text-[13.5px] font-semibold text-text">{t.door.payBanner}</span>
          </div>
        )}

        <Label className="mx-0.5 mb-[10px] mt-1.5">{t.door.logTitle}</Label>
        <div className="mb-4 rounded-[14px] border border-line bg-elev px-[14px] py-1">
          <LogRow icon="user" label={t.door.logAdded} who={g.addedByName} when={g.addedAt} />
          {g.plus > 0 && <LogRow icon="users" label={t.door.logPlusOnes} who={fmt(t.door.logPlusOnesTickets, { n: g.plus })} />}
          {g.inside ? (
            <LogRow icon="check2" label={g.arrived && g.arrived > 0 ? fmt(t.door.logCheckedInPlus, { n: g.arrived }) : t.door.logCheckedIn} who={g.inByName ?? t.door.logActorFallback} when={g.inAt} accent last />
          ) : g.voided ? (
            <LogRow icon="history" label={t.door.logReversed} who={t.door.statusOnTheWay} last />
          ) : (
            <LogRow icon="clock" label={t.door.logNotCheckedIn} who={t.door.statusOnTheWay} last />
          )}
        </div>

        {g.inside && remaining > 0 && (
          <>
            <Label className="mb-[9px]">{t.door.partyNotAllInTitle}</Label>
            <div className="mb-3 rounded-[14px] border border-line bg-elev p-[14px]">
              <div className="mb-3 text-[13.5px] text-faint">
                <span className="font-semibold text-text">{1 + (g.arrived ?? 0)}</span> {fmt(t.door.partyOfInsideTail, { total: 1 + g.plus, n: remaining })}
              </div>
              <Stepper value={addClamped} onChange={(v) => setAddNow(Math.min(remaining, Math.max(1, v)))} />
            </div>
            <Btn
              kind="primary"
              full
              icon="check"
              onClick={() => {
                topUp(g.id, addClamped);
                onBack();
              }}
            >
              {fmt(t.door.checkInMoreBtn, { n: addClamped })}
            </Btn>
          </>
        )}

        {g.inside &&
          (allowUncheck ? (
            <Btn
              kind="ghost"
              full
              icon="history"
              onClick={() => {
                voidCheckIn(g.id);
                onBack();
              }}
            >
              {t.door.uncheckBtn}
            </Btn>
          ) : (
            <div className="flex items-center gap-[9px] rounded-[13px] border border-dashed border-line bg-elev px-[14px] py-[11px] text-[12.5px] text-faint">
              <Icon name="lock" size={15} className="text-faint" />
              {t.door.uncheckDisabled}
            </div>
          ))}

        {!g.inside && (
          <>
            <Label className="mb-[9px]">{g.voided ? t.door.reCheckInTitle : t.door.howManyComingIn}</Label>
            <div className="mb-4">
              {/* Cap at the guest's allotment (1 + their +N): you can never check in
                  more people than were on the list. The DB clamps too (#22). */}
              <Stepper value={plus + 1} max={1 + g.plus} onChange={(v) => setPlus(Math.min(g.plus, Math.max(0, v - 1)))} />
            </div>
            <Btn kind="ghost" full icon="close" onClick={() => setRefuseOpen(true)}>
              {t.door.refuseBtn}
            </Btn>
          </>
        )}
      </Scroll>

      <BottomBar>
        {g.inside ? (
          <div className="flex items-center justify-center gap-[8px] py-[6px] font-display text-[15px] font-bold text-acc">
            <Icon name="check2" size={18} stroke="#B5A6FF" sw={2.4} />
            {g.inAt ? fmt(t.door.inAt, { time: g.inAt }) : t.door.inside}
            {g.inByName ? <span className="font-body text-[12.5px] font-semibold text-faint">· {fmt(t.door.inBy, { name: g.inByName })}</span> : null}
          </div>
        ) : (
          <Btn
            kind="primary"
            full
            icon="check"
            onClick={() => {
              if (g.voided) reviveCheckIn(g.id, total);
              else checkIn(g.id, total);
              onBack();
            }}
          >
            {fmt(t.door.checkInStepper, {
              label: g.voided ? t.door.reCheckIn : t.door.checkIn,
              n: total,
              unit: total === 1 ? t.door.personSingular : t.door.personPlural,
            })}
          </Btn>
        )}
      </BottomBar>

      {refuseOpen && (
        <Sheet onClose={() => setRefuseOpen(false)} center={false}>
          <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.door.refuseTitle}</div>
          <div className="mb-4 text-[13px] text-faint">{t.door.refuseSub}</div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoFocus
            placeholder={t.door.refusePlaceholder}
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
            {fmt(t.door.refuseConfirm, { name: g.name })}
          </Btn>
          <button type="button" onClick={() => setRefuseOpen(false)} className={cn('mt-[10px] cursor-pointer border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
            {t.door.cancel}
          </button>
        </Sheet>
      )}

      {alertOpen && (
        <Sheet onClose={() => setAlertOpen(false)} center>
          <div className="mb-[14px] flex h-[52px] w-[52px] items-center justify-center rounded-[16px] bg-acc">
            <Icon name="warn" size={28} stroke="#16132B" sw={2.2} />
          </div>
          <div className="font-display text-[22px] font-extrabold tracking-[-0.01em] text-text">{t.door.alertTitle}</div>
          <div className="mb-[14px] mt-0.5 text-[13px] text-faint">{fmt(t.door.alertSub, { name: g.name })}</div>
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
            {t.door.alertConfirm}
          </Btn>
          <button type="button" onClick={() => setAlertOpen(false)} className={cn('mt-[10px] cursor-pointer border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
            {t.door.alertLater}
          </button>
        </Sheet>
      )}
    </div>
  );
}
