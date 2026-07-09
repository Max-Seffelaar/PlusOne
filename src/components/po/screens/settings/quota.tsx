'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { venueCapabilities } from '@/features/venues/access';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { usePoTeam, usePoEvents, usePoEventAllowance, type PoAllowanceMember } from '@/features/po/hooks';
import { usePoSetDefaultQuota, usePoSetAllowance } from '@/features/po/mutations';
import type { PoTeamMember } from '@/features/po/adapters';
import { useMfaGate, isAal2Error } from '../../mfa-gate';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Avatar, Empty, IconBtn, Label, MiniChip, Note, Scroll, Top, press } from '../../kit';
import { Sheet } from '../../shell';
import { col, FormError } from './_shared';

// ── GEBRUIKERS & TOELAGES (pushed) — S6 default-quota, live ───────────────────
// Per-member DEFAULT quota (quotas.default_count, falling back to the venue
// default). Per-event overrides (event_quotas) live on the "Toelage per event"
// screen — out of scope here. Editing is admin-only + AAL2 (setDefaultQuota).
export function Rollen(): JSX.Element {
  const nav = useNav();
  const { roles } = usePoIdentity();
  const caps = venueCapabilities(roles);
  const team = usePoTeam();

  if (!caps.viewQuota) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.quota.rolesTitle} />
        <Scroll bottom={24}>
          <Empty text={t.settings.quota.rolesNoRights} />
        </Scroll>
      </div>
    );
  }

  const members = team.data ?? [];
  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.settings.quota.rolesTitle} />
      <Scroll bottom={28}>
        <Note icon="ticket">
          {caps.editQuota ? t.settings.quota.rolesNoteAdmin : t.settings.quota.rolesNoteReadonly}
        </Note>
        {team.isLoading ? (
          <Empty text={t.settings.quota.loading} />
        ) : team.isError ? (
          <Empty text={t.settings.quota.rolesLoadError} />
        ) : members.length === 0 ? (
          <Empty text={t.settings.quota.rolesEmpty} />
        ) : (
          <div className="flex flex-col gap-[11px]">
            {members.map((m) => (
              <MemberQuotaRow key={m.userId} member={m} canEdit={caps.editQuota} />
            ))}
          </div>
        )}
      </Scroll>
    </div>
  );
}

// One member's default-quota editor. Local stepper value re-syncs to the server
// value after a save (the team query refetches); a "Opslaan" chip appears only
// while the value differs. Read-only for finance.
function MemberQuotaRow({ member, canEdit }: { member: PoTeamMember; canEdit: boolean }): JSX.Element {
  const setQuota = usePoSetDefaultQuota();
  const mfa = useMfaGate();
  const [value, setValue] = useState(member.quota);
  useEffect(() => {
    setValue(member.quota);
  }, [member.quota]);
  const changed = value !== member.quota;
  const save = (): void =>
    setQuota.mutate({ userId: member.userId, defaultCount: value }, { onError: (e) => mfa.guard(e, save) });
  const stepBtn = cn('flex h-[42px] w-[42px] items-center justify-center rounded-[13px] border border-line bg-elev2 text-text', press);

  return (
    <div className="rounded-[16px] border border-line bg-elev p-[14px]">
      <div className="mb-3 flex items-center gap-[12px]">
        <Avatar name={member.name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] font-bold text-text">{member.name}</div>
          <div className="truncate text-[12px] text-faint">{member.rolesLabel}</div>
        </div>
        {canEdit && changed && (
          <MiniChip onClick={save} className="border-transparent bg-acc text-on-acc">
            {setQuota.isPending ? t.settings.quota.saving : t.settings.quota.save}
          </MiniChip>
        )}
      </div>
      {canEdit ? (
        <div className="flex items-center justify-between gap-[14px] rounded-[16px] bg-acc-dim p-[9px]">
          <button type="button" onClick={() => setValue((v) => Math.max(0, v - 1))} className={stepBtn} aria-label={t.settings.quota.less}>
            <Icon name="minus" size={20} sw={2.4} />
          </button>
          <div className="text-center">
            <div className="font-display text-[26px] font-extrabold leading-none text-text">{value}</div>
            <div className="mt-0.5 text-[11px] text-dim">{t.settings.quota.guestsPerEvent}</div>
          </div>
          <button type="button" onClick={() => setValue((v) => v + 1)} className={stepBtn} aria-label={t.settings.quota.more}>
            <Icon name="plus" size={20} sw={2.4} stroke="#B5A6FF" />
          </button>
        </div>
      ) : (
        <div className="rounded-[14px] bg-elev2 px-[14px] py-[12px] text-center">
          <span className="font-display text-[18px] font-extrabold text-text">{member.quota}</span>
          <span className="ml-1.5 text-[12px] text-faint">{t.settings.quota.guestsPerEvent}</span>
        </div>
      )}
      <FormError error={setQuota.isError && !isAal2Error(setQuota.error) ? setQuota.error : null} />
      {mfa.sheet}
    </div>
  );
}

// ── TOELAGE PER EVENT (pushed) ───────────────────────────────────────────────
// Per-event quota override (event_quotas) for every venue member, event picked
// via the calendar icon (defaults to the nearest-listed upcoming event — same
// convention as QuickAdd's curEv). Role-only RLS (admin writes, admin/finance
// view; #20 2026-06-24 refinement), so no MFA step-up like MemberQuotaRow.
export function Allowance(): JSX.Element {
  const nav = useNav();
  const { roles } = usePoIdentity();
  const caps = venueCapabilities(roles);
  const eventsQ = usePoEvents();
  const upcoming = (eventsQ.data ?? []).filter((e) => e.when === 'upcoming');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const eventId = pickedId ?? upcoming[0]?.id ?? null;
  const event = upcoming.find((e) => e.id === eventId) ?? null;
  const allowanceQ = usePoEventAllowance(eventId);
  const members = allowanceQ.data ?? [];

  if (!caps.viewQuota) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.quota.allowanceTitle} />
        <Scroll bottom={24}>
          <Empty text={t.settings.quota.rolesNoRights} />
        </Scroll>
      </div>
    );
  }

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={t.settings.quota.allowanceTitle}
        sub={event?.name}
        right={<IconBtn name="cal" onClick={() => setPicking(true)} />}
      />
      <Scroll bottom={28}>
        <Note icon="ticket">
          {t.settings.quota.allowanceNotePre}
          <b>{t.settings.quota.allowanceNoteBold}</b>
          {t.settings.quota.allowanceNotePost}
        </Note>
        {eventsQ.isLoading || (allowanceQ.isLoading && !!eventId) ? (
          <Empty text={t.settings.quota.loading} />
        ) : !eventId ? (
          <Empty text={t.settings.quota.noUpcomingEvents} />
        ) : allowanceQ.isError ? (
          <Empty text={t.settings.quota.rolesLoadError} />
        ) : members.length === 0 ? (
          <Empty text={t.settings.quota.rolesEmpty} />
        ) : (
          <>
            <Label className="mb-[10px]">{fmt(t.settings.quota.allowanceMembers, { event: event?.name ?? '' })}</Label>
            <div className="flex flex-col gap-[10px]">
              {members.map((m) => (
                <AllowanceRow key={m.userId} member={m} eventId={eventId} canEdit={caps.editQuota} />
              ))}
            </div>
          </>
        )}
      </Scroll>
      {picking && (
        <Sheet onClose={() => setPicking(false)} center={false}>
          <Label className="mb-[10px]">{t.settings.quota.pickEventTitle}</Label>
          {upcoming.length === 0 ? (
            <Empty text={t.settings.quota.noUpcomingEvents} />
          ) : (
            <div className="flex flex-col gap-2">
              {upcoming.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => {
                    setPickedId(e.id);
                    setPicking(false);
                  }}
                  className={cn(
                    'rounded-[14px] border px-4 py-3 text-left text-[14.5px] font-semibold',
                    e.id === eventId ? 'border-transparent bg-acc-dim text-acc' : 'border-line bg-elev2 text-text',
                    press,
                  )}
                >
                  {e.name}
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}

// One member's per-event quota override. Local stepper value re-syncs to the
// server value after a save; a "Save" chip appears only while it differs from
// the live override. Mirrors MemberQuotaRow, scoped to one event.
function AllowanceRow({
  member,
  eventId,
  canEdit,
}: {
  member: PoAllowanceMember;
  eventId: string;
  canEdit: boolean;
}): JSX.Element {
  const setAllowance = usePoSetAllowance(eventId);
  const [value, setValue] = useState(member.override);
  useEffect(() => {
    setValue(member.override);
  }, [member.override]);
  const changed = value !== member.override;
  const save = (): void => setAllowance.mutate({ userId: member.userId, quota: value });
  const stepBtn = cn('flex h-[46px] w-[46px] items-center justify-center rounded-[14px] border border-line bg-elev2 text-text', press);

  return (
    <div className="rounded-[18px] border border-line bg-elev p-[14px]">
      <div className="mb-3 flex items-center gap-[12px]">
        <Avatar name={member.name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] font-bold text-text">{member.name}</div>
          <div className="text-[12px] text-faint">
            {member.rolesLabel} · {fmt(t.settings.quota.allowanceDefault, { n: member.quota })}
          </div>
        </div>
        {canEdit && changed && (
          <MiniChip onClick={save} className="border-transparent bg-acc text-on-acc">
            {setAllowance.isPending ? t.settings.quota.saving : t.settings.quota.save}
          </MiniChip>
        )}
      </div>
      {canEdit ? (
        <div className="flex items-center justify-between gap-[14px] rounded-[16px] bg-acc-dim p-[9px]">
          <button type="button" onClick={() => setValue((v) => Math.max(0, v - 1))} className={stepBtn} aria-label={t.settings.quota.less}>
            <Icon name="minus" size={20} sw={2.4} />
          </button>
          <div className="text-center">
            <div className="font-display text-[26px] font-extrabold leading-none text-text">{value}</div>
            <div className="mt-0.5 text-[11px] text-dim">{t.settings.quota.spots}</div>
          </div>
          <button type="button" onClick={() => setValue((v) => v + 1)} className={stepBtn} aria-label={t.settings.quota.more}>
            <Icon name="plus" size={20} sw={2.4} stroke="#B5A6FF" />
          </button>
        </div>
      ) : (
        <div className="rounded-[14px] bg-elev2 px-[14px] py-[12px] text-center">
          <span className="font-display text-[18px] font-extrabold text-text">{member.override}</span>
          <span className="ml-1.5 text-[12px] text-faint">{t.settings.quota.spots}</span>
        </div>
      )}
      <FormError error={setAllowance.isError ? setAllowance.error : null} />
    </div>
  );
}
