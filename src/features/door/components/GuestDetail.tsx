'use client';

/**
 * Guest detail (decision #39): logboek (toegevoegd door/wanneer, +N, ingecheckt
 * hoe laat/door wie — built from guests/check_ins, never audit_log), group-first
 * check-in, refuse flow with a mandatory reason (#10), and the "Let op!" popup
 * for high-priority notes. Recreated from the prototype `Guest` screen.
 *
 * Group-first (z8uq9m2vg6, decisions 2026-10-06): no "how many?" question. The
 * primary action checks in everyone still outside — "Check in all (N)" — and
 * "Check in 1" lets them in one at a time, showing the running count (3/4).
 * Both are the same absolute-count write in the outbox, so they work offline
 * and a second tap simply updates the first. A guest already inside can have
 * their check-in undone ("terugdraaien", soft void #3) when this user may undo
 * here (admin/user manager always, door host/crew with the company setting on).
 */
import { type JSX, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { Icon, type IconName } from '@/components/po/icon';
import { Avatar, Btn, CountPill, IconBtn, Label, PayChip, Scroll, Top, press } from '@/components/po/kit';
import { BottomBar, Sheet } from '@/components/po/shell';
import { PlusOnesSheet } from '@/components/po/screens/guests/profile-sheets';
import { useDoor, useDoorSyncStatus } from '../DoorProvider';
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

/**
 * The "…" menu in the door overlay (ADE UX round, item M2).
 *
 * Its own component so `useDoorSyncStatus()` — which ticks every 15s — is only
 * subscribed while the sheet is actually open. The door deliberately split that
 * context off the broad one (86ey9e8gf) precisely so a 15s tick does not
 * re-render the guest detail; mounting the hook here keeps that true.
 *
 * ONLINE-ONLY, on purpose: changing plus-ones is a plain guest update that the
 * database has to validate against the quota engine and the list lock (#22/#23),
 * and the door outbox has no guest-update op (kinds: check_in, refusal,
 * add_guest — #25). Queueing it would mean showing a doorhost a number the
 * server may later refuse. So offline the action is disabled and says why;
 * check-in itself keeps working offline, unchanged.
 */
function GuestActionsSheet({
  onClose,
  onEditPlusOnes,
}: {
  onClose: () => void;
  onEditPlusOnes: () => void;
}): JSX.Element {
  const { online } = useDoorSyncStatus();
  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-4 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.door.actionsTitle}</div>
      <button
        type="button"
        disabled={!online}
        onClick={online ? onEditPlusOnes : undefined}
        className={cn(
          'flex w-full items-center gap-[12px] rounded-[14px] border border-line bg-elev p-[14px] text-left',
          online ? press : 'cursor-not-allowed opacity-[0.55]',
        )}
      >
        <span className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[12px] bg-elev2 text-text">
          <Icon name={online ? 'users' : 'lock'} size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[15px] font-bold text-text">{t.door.actionEditPlusOnes}</span>
          <span className="mt-px block text-[12.5px] text-faint">
            {online ? t.door.actionEditPlusOnesSub : t.door.actionNeedsConnection}
          </span>
        </span>
      </button>
      {!online && <div className="mt-3 text-[12.5px] leading-[1.45] text-faint">{t.door.actionOfflineHint}</div>}
      <Btn full kind="ghost" className="mt-4" onClick={onClose}>
        {t.door.cancel}
      </Btn>
    </Sheet>
  );
}

export function GuestDetail({ guestId, onBack }: { guestId: string; onBack: () => void }): JSX.Element | null {
  const { eventId, guestById, checkIn, checkInOne, voidCheckIn, reviveCheckIn, refuse, ackNote, canUncheck } = useDoor();
  const g = guestById(guestId);
  const [alertOpen, setAlertOpen] = useState(g?.notePriority === 'high' && !g?.acknowledged);
  const [refuseOpen, setRefuseOpen] = useState(false);
  const [reason, setReason] = useState('');
  // 'actions' = the "…" sheet, 'plusOnes' = the shared +N editor on top of it.
  const [menu, setMenu] = useState<'actions' | 'plusOnes' | null>(null);

  if (!g) return null;
  const party = 1 + g.plus;
  // People of this party inside right now, and still outside.
  const insideNow = g.inside ? 1 + (g.arrived ?? 0) : 0;
  const outside = party - insideNow;
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
            <IconBtn name="dots" ariaLabel={t.door.actionsAria} onClick={() => setMenu('actions')} />
          </>
        }
      />
      <Scroll bottom={20}>
        <div className="flex flex-col items-center px-0 pb-[18px] pt-1.5 text-center">
          {/* Avatar fill = the guest's TIER colour (ADE UX round, item I), not a
              lavender "is this tier VIP-ish?" guess: a mint VIP tier now reads
              mint here exactly as it does on the row. `dim` mutes it once they
              are inside, the same muting the check-in list uses. */}
          <Avatar name={g.name} size={84} color={g.tierColor} dim={g.inside} />
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

        {g.inside &&
          (canUncheck ? (
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
          <Btn kind="ghost" full icon="close" onClick={() => setRefuseOpen(true)}>
            {t.door.refuseBtn}
          </Btn>
        )}
      </Scroll>

      <BottomBar>
        {outside === 0 ? (
          <div className="flex items-center justify-center gap-[8px] py-[6px] font-display text-[15px] font-bold text-acc">
            <Icon name="check2" size={18} stroke="#B5A6FF" sw={2.4} />
            {g.inAt ? fmt(t.door.inAt, { time: g.inAt }) : t.door.inside}
            {g.inByName ? <span className="font-body text-[12.5px] font-semibold text-faint">· {fmt(t.door.inBy, { name: g.inByName })}</span> : null}
          </div>
        ) : (
          <>
            {/* Group-first (z8uq9m2vg6): the whole party is the default, one at a
                time is the exception. Both buttons sit in the fixed bottom block
                so they always fit the viewport above a long log (feedback 10/7). */}
            {g.inside && (
              <div className="mb-[10px] text-center text-[13px] text-faint">
                <span className="font-semibold text-text">{insideNow}</span> {fmt(t.door.partyOfInsideTail, { total: party, n: outside })}
              </div>
            )}
            {g.voided && <Label className="mb-[9px]">{t.door.reCheckInTitle}</Label>}
            <Btn
              kind="primary"
              full
              icon="check"
              onClick={() => {
                if (g.voided) reviveCheckIn(g.id, party);
                else checkIn(g.id, party);
                onBack();
              }}
            >
              {party === 1
                ? g.voided
                  ? t.door.reCheckIn
                  : t.door.checkIn
                : fmt(t.door.checkInAllBtn, { n: outside })}
            </Btn>
            {party > 1 && (
              // Stays on this screen: the doorhost taps once per person and
              // watches the count climb (3/4); "Check in all" is the way out.
              <Btn kind="ghost" full className="mt-[9px]" onClick={() => checkInOne(g.id)}>
                {t.door.checkInOneBtn}
                <CountPill ariaLabel={fmt(t.door.partyCountAria, { inside: insideNow, total: party })}>
                  {fmt(t.door.partyCount, { inside: insideNow, total: party })}
                </CountPill>
              </Btn>
            )}
          </>
        )}
      </BottomBar>

      {menu === 'actions' && (
        <GuestActionsSheet onClose={() => setMenu(null)} onEditPlusOnes={() => setMenu('plusOnes')} />
      )}

      {/* The SAME sheet the guest profile uses (ADE UX round, item M1/M2) — one
          +N editor, one set of quota/lock error messages, one slot-cost line.
          It writes through the shared server action, never the door outbox. */}
      {menu === 'plusOnes' && (
        <PlusOnesSheet
          guestId={g.id}
          eventId={eventId}
          name={g.name}
          current={g.plus}
          onClose={() => setMenu(null)}
          onSaved={() => setMenu(null)}
        />
      )}

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
