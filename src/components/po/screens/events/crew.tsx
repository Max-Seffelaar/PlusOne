'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { usePoAssignableCrew, usePoCrew, usePoEvent, usePoEventForEdit } from '@/features/po/hooks';
import type { PoCrewMember } from '@/features/po/queries';
import {
  usePoAssignCrew,
  usePoInviteExternalCrew,
  usePoRemoveCrew,
  usePoSetCrewQuota,
} from '@/features/po/mutations';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Avatar, Btn, Empty, Field, Label, MiniChip, Note, Scroll, Top, press } from '../../kit';
import { Sheet } from '../../shell';
import { col } from './shared';

// ── EXTERNAL CREW (pushed) — event_organizers + per-event quota (#6/#24, 86ey21vre) ──
// Event-scoped EXTERNAL people (a DJ, artist, guest organizer). Venue Team works
// every event already, so they're not shown here. Each crew member has a guest
// quota (event_quotas). Add/remove/quota is admin-only (RLS, role-only since the
// #20 2026-06-24 refinement); non-admins see a read-only list.
const crewStep = cn('flex h-[32px] w-[32px] items-center justify-center rounded-[9px] border border-line bg-elev2 text-text', press);

/** Tiny inline error under a crew sub-form action. */
function CrewError({ show, text }: { show: boolean; text: string }): JSX.Element | null {
  return show ? <p className="mt-2 text-[12px] text-red-300" role="alert">{text}</p> : null;
}

/** One crew member: name/email + an editable guest quota (Save chip on change) + remove. */
function CrewMemberRow({ eventId, member, canManage }: { eventId: string; member: PoCrewMember; canManage: boolean }): JSX.Element {
  const setQuota = usePoSetCrewQuota(eventId);
  const removeCrew = usePoRemoveCrew(eventId);
  const [value, setValue] = useState(member.quota);
  useEffect(() => setValue(member.quota), [member.quota]);
  const changed = value !== member.quota;
  return (
    <div className="rounded-[16px] border border-line bg-elev p-[13px]">
      <div className="flex items-center gap-[12px]">
        <Avatar name={member.fullName} size={42} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] font-bold text-text">{member.fullName}</div>
          <div className="mt-0.5 truncate text-[12px] text-faint">{member.email}</div>
        </div>
        {canManage && (
          <MiniChip onClick={() => removeCrew.mutate({ eventId, userId: member.userId })}>
            {removeCrew.isPending ? t.events.crew.removing : t.events.crew.remove}
          </MiniChip>
        )}
      </div>
      {canManage && (
        <>
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
                <MiniChip onClick={() => setQuota.mutate({ eventId, userId: member.userId, quota: value })} className="ml-1 border-transparent bg-acc text-on-acc">
                  {setQuota.isPending ? t.events.crew.saving : t.events.crew.save}
                </MiniChip>
              )}
            </div>
          </div>
          <CrewError show={setQuota.isError} text={t.events.crew.assignError} />
          <CrewError show={removeCrew.isError} text={t.events.crew.removeError} />
        </>
      )}
    </div>
  );
}

/** A returning external person from the pool: a quota input + Add. */
function CrewPoolRow({ eventId, member, defaultQuota }: { eventId: string; member: PoCrewMember; defaultQuota: number }): JSX.Element {
  const assign = usePoAssignCrew(eventId);
  const [q, setQ] = useState(String(defaultQuota));
  const add = (): void => assign.mutate({ eventId, userId: member.userId, quota: q === '' ? undefined : Number(q) });
  return (
    <div className="rounded-[13px] border border-line bg-elev2 p-[11px]">
      <div className="flex items-center gap-[12px]">
        <Avatar name={member.fullName} size={36} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[14px] font-bold text-text">{member.fullName}</div>
          <div className="mt-0.5 truncate text-[12px] text-faint">{member.email}</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-[10px] border border-line bg-elev px-2.5 py-[7px]">
          <Icon name="ticket" size={14} className="text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            inputMode="numeric"
            placeholder={String(defaultQuota)}
            aria-label={t.events.crew.quotaInputAria}
            className="w-[40px] bg-transparent text-[13.5px] text-text outline-none placeholder:text-faint"
          />
          <span className="text-[12px] text-faint">{t.events.crew.quotaUnit}</span>
        </div>
        <Btn kind="primary" sm icon="plus" className="flex-1" onClick={add} disabled={assign.isPending}>
          {assign.isPending ? t.events.crew.assigning : t.events.crew.assignCta}
        </Btn>
      </div>
      <CrewError show={assign.isError} text={t.events.crew.assignError} />
    </div>
  );
}

export function Crew({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const id = eventId ?? '';
  const { event } = usePoEvent(id);
  const { roles } = usePoIdentity();
  const isAdmin = roles.includes('admin');

  const crewQ = usePoCrew(id);
  // The returning-crew pool is only needed for the admin "add" path.
  const poolQ = usePoAssignableCrew(isAdmin ? id : '');
  // Prefill new crew quotas from THIS event's default (T10) — not the venue
  // default. The event value is seeded from the venue default at creation and
  // then editable per event, so two events can carry different defaults.
  const edit = usePoEventForEdit(id);
  const defaultQuota = edit.data?.defaultMemberQuota ?? 0;
  const invite = usePoInviteExternalCrew();

  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteQuota, setInviteQuota] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Prefill the invite quota with the event's default once it loads.
  useEffect(() => {
    if (edit.data) setInviteQuota((q) => (q === '' ? String(defaultQuota) : q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit.data]);

  const crew = crewQ.data ?? [];
  const pool = (poolQ.data ?? []).filter((m) => {
    const q = search.trim().toLowerCase();
    return !q || m.fullName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  });
  const canInvite = /.+@.+\..+/.test(email) && !invite.isPending;

  const doInvite = (): void => {
    setErr(null);
    setNotice(null);
    invite.mutate(
      { email: email.trim(), eventIds: [id], quota: inviteQuota === '' ? undefined : Number(inviteQuota) },
      {
        onSuccess: () => {
          setEmail('');
          setAddOpen(false);
          setNotice(t.events.crew.inviteDone);
        },
        onError: (e) => setErr(e instanceof Error ? e.message : t.events.crew.inviteError),
      },
    );
  };

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.events.crew.title} sub={event?.name} />
      <Scroll bottom={28}>
        <Note icon="users">{t.events.crew.explainer}</Note>

        <Label className="mb-[10px]">{t.events.crew.listLabel}</Label>
        {crewQ.isLoading ? (
          <Empty text={t.events.crew.loading} />
        ) : crewQ.isError ? (
          <Empty text={t.events.crew.loadError} />
        ) : crew.length === 0 ? (
          <Empty text={t.events.crew.empty} />
        ) : (
          <div className="mb-5 flex flex-col gap-[9px] lg:grid lg:grid-cols-2 lg:gap-[10px]">
            {crew.map((m) => (
              <CrewMemberRow key={m.userId} eventId={id} member={m} canManage={isAdmin} />
            ))}
          </div>
        )}

        {!isAdmin ? (
          <Note icon="shield">{t.events.crew.adminOnly}</Note>
        ) : (
          <Btn
            kind="primary"
            full
            icon="plus"
            className="mt-[18px]"
            onClick={() => {
              setErr(null);
              setNotice(null);
              setSearch('');
              setAddOpen(true);
            }}
          >
            {t.events.crew.addHeading}
          </Btn>
        )}

        {notice && (
          <p className="mt-3 text-[12.5px] text-acc-soft" role="status">
            {notice}
          </p>
        )}
      </Scroll>

      {/* Add flow in a sheet (keeps the screen to "list + one button", S6 feedback). */}
      {addOpen && isAdmin && (
        <Sheet onClose={() => setAddOpen(false)} center={false}>
          <div className="mb-1 font-display text-[17px] font-bold text-text">{t.events.crew.addHeading}</div>
          <p className="mb-4 text-[12.5px] leading-[1.45] text-faint">{t.events.crew.addExplainer}</p>

          {/* Way 1: invite a brand-new external person by email, with a quota. */}
          <Label className="mb-2">{t.events.crew.inviteLabel}</Label>
          <p className="mb-2.5 text-[12.5px] leading-[1.45] text-faint">{t.events.crew.inviteHint}</p>
          <Field icon="mail" placeholder={t.events.crew.invitePlaceholder} value={email} onChange={setEmail} inputMode="email" className="mb-2.5" />
          <Field
            icon="ticket"
            placeholder={String(defaultQuota)}
            value={inviteQuota}
            onChange={(v) => setInviteQuota(v.replace(/[^0-9]/g, '').slice(0, 4))}
            inputMode="numeric"
            className="mb-1.5"
          />
          <div className="mb-2.5 pl-0.5 text-[12px] leading-[1.4] text-faint">{t.events.crew.quotaHelp}</div>
          <Btn kind="primary" full icon="plus" disabled={!canInvite} className={canInvite ? '' : 'opacity-[0.45]'} onClick={doInvite}>
            {invite.isPending ? t.events.crew.inviting : t.events.crew.inviteCta}
          </Btn>
          {err && (
            <p className="mt-2 text-[12px] text-red-300" role="alert">
              {err}
            </p>
          )}

          <div className="my-4 border-t border-line2" />

          {/* Way 2: add a returning external person (searchable pool), with a quota. */}
          <Label className="mb-2">{t.events.crew.assignLabel}</Label>
          <p className="mb-2.5 text-[12.5px] leading-[1.45] text-faint">{t.events.crew.assignHint}</p>
          {poolQ.isLoading ? (
            <div className="py-2 text-[12.5px] text-faint">{t.events.crew.loading}</div>
          ) : (poolQ.data ?? []).length === 0 ? (
            <div className="rounded-[13px] border border-dashed border-line bg-elev2 px-[14px] py-[12px] text-[12.5px] text-faint">
              {t.events.crew.assignEmpty}
            </div>
          ) : (
            <>
              <Field icon="search" placeholder={t.events.crew.searchPlaceholder} value={search} onChange={setSearch} className="mb-3" />
              {pool.length === 0 ? (
                <div className="py-2 text-[12.5px] text-faint">{t.events.crew.searchEmpty}</div>
              ) : (
                <div className="flex max-h-[40vh] flex-col gap-[9px] overflow-y-auto">
                  {pool.map((m) => (
                    <CrewPoolRow key={m.userId} eventId={id} member={m} defaultQuota={defaultQuota} />
                  ))}
                </div>
              )}
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
