'use client';

/** Team → External crew → Manage (z8uq9m2yvp): one sheet per crew member with
 *  every event of this company they are crew on. Per event the guest quota
 *  (setEventUserQuota) and Remove from crew behind a confirm step
 *  (removeOrganizer). The same actions and the same admin-only gate as an
 *  event's crew sheet: RLS (event_quotas / event_organizers, admin) stays the
 *  boundary; the caller only renders this for admins. The member is read live
 *  from the venue-crew query, so a removal updates the sheet in place. */
import { type JSX, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { usePoVenueCrew } from '@/features/po/hooks';
import { usePoRemoveCrew, usePoSetCrewQuota } from '@/features/po/mutations';
import type { PoVenueCrewMember } from '@/features/po/adapters';
import { Icon } from '../../icon';
import { Avatar, Btn, Label, MiniChip, Note } from '../../kit';
import { Sheet } from '../../shell';
import { crewStep, CrewError } from '../events/crew';

type CrewEvent = PoVenueCrewMember['events'][number];

function CrewEventRow({ member, ev }: { member: PoVenueCrewMember; ev: CrewEvent }): JSX.Element {
  const setQuota = usePoSetCrewQuota(ev.eventId);
  const removeCrew = usePoRemoveCrew(ev.eventId);
  const [value, setValue] = useState(ev.quota);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setValue(ev.quota), [ev.quota]);
  const changed = value !== ev.quota;

  return (
    <div className="rounded-[16px] border border-line bg-elev p-[13px]" data-testid="crew-event-row">
      <div className="flex items-center gap-[10px]">
        <Icon name="cal" size={16} className="shrink-0 text-faint" />
        <div className="min-w-0 flex-1 truncate font-display text-[15px] font-bold text-text">{ev.name}</div>
        {!confirming && <MiniChip onClick={() => setConfirming(true)}>{t.settings.team.crewRemove}</MiniChip>}
      </div>

      {confirming ? (
        <div className="mt-3 rounded-[13px] bg-acc-dim px-[12px] py-[10px]">
          <p className="m-0 text-[12.5px] leading-[1.45] text-dim">
            {fmt(t.settings.team.crewRemoveConfirm, { name: member.name, event: ev.name })}
          </p>
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <MiniChip onClick={() => setConfirming(false)}>{t.settings.common.cancel}</MiniChip>
            <MiniChip
              onClick={() => removeCrew.mutate({ eventId: ev.eventId, userId: member.userId })}
              className="border-transparent bg-acc text-on-acc"
            >
              {removeCrew.isPending ? t.settings.team.crewRemoving : t.settings.team.crewRemoveConfirmBtn}
            </MiniChip>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-[13px] bg-acc-dim px-[12px] py-[8px]">
          <span className="text-[12.5px] text-dim">{t.events.crew.quotaRowLabel}</span>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setValue((v) => Math.max(0, v - 1))} className={crewStep} aria-label={t.events.crew.quotaLess}>
              <Icon name="minus" size={15} sw={2.4} />
            </button>
            <span className="min-w-[24px] text-center font-display text-[17px] font-extrabold text-text">{value}</span>
            <button type="button" onClick={() => setValue((v) => v + 1)} className={cn(crewStep, 'text-acc')} aria-label={t.events.crew.quotaMore}>
              <Icon name="plus" size={15} sw={2.4} stroke="#B5A6FF" />
            </button>
            {changed && (
              <MiniChip
                onClick={() => setQuota.mutate({ eventId: ev.eventId, userId: member.userId, quota: value })}
                className="ml-1 border-transparent bg-acc text-on-acc"
              >
                {setQuota.isPending ? t.events.crew.saving : t.events.crew.save}
              </MiniChip>
            )}
          </div>
        </div>
      )}
      <CrewError show={setQuota.isError} text={t.settings.team.crewSaveError} />
      <CrewError show={removeCrew.isError} text={t.settings.team.crewRemoveError} />
    </div>
  );
}

export function CrewManageSheet({ userId, onClose }: { userId: string; onClose: () => void }): JSX.Element {
  const crewQ = usePoVenueCrew();
  const member = (crewQ.data ?? []).find((m) => m.userId === userId) ?? null;

  return (
    <Sheet onClose={onClose} center={false}>
      {member ? (
        <>
          <div className="mb-4 flex items-center gap-[12px]">
            <Avatar name={member.name} size={44} />
            <div className="min-w-0 flex-1">
              <div className="font-display text-[16px] font-bold text-text">{member.name}</div>
              <div className="truncate text-[12px] text-faint">{member.email}</div>
            </div>
          </div>
          <Label className="mb-[10px]">{t.settings.team.crewSheetEventsLabel}</Label>
          <div className="flex flex-col gap-[9px]">
            {member.events.map((ev) => (
              <CrewEventRow key={ev.eventId} member={member} ev={ev} />
            ))}
          </div>
        </>
      ) : (
        <Note icon="users">{t.settings.team.crewSheetGone}</Note>
      )}
      <Btn kind="ghost" full className="mt-4" onClick={onClose}>
        {t.settings.team.crewSheetDone}
      </Btn>
    </Sheet>
  );
}
