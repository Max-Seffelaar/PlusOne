'use client';

import { type JSX, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { canGrantRoles, requiresMfa, type VenueRole } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { usePoTeam, usePoInvites, usePoVenueCrew, usePoEvents, useBillingBlocked } from '@/features/po/hooks';
import {
  usePoInviteUser,
  usePoInviteExternalCrew,
  usePoRevokeInvite,
  usePoResendInvite,
  usePoResendCrewInvite,
  usePoUpdateMemberRoles,
  usePoRemoveMember,
} from '@/features/po/mutations';
import type { PoTeamMember } from '@/features/po/adapters';
import { useMfaGate, isAal2Error } from '../../mfa-gate';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Avatar, Btn, Empty, Field, IconBtn, Label, Loading, MiniChip, Note, Scroll, Top, press, cardPress } from '../../kit';
import { BottomBar, Sheet } from '../../shell';
import { col, FormError, RolePicker } from './_shared';

// ── GEBRUIKERS (pushed) — S6 Team-beheer, live ───────────────────────────────
export function Gebruikers(): JSX.Element {
  const nav = useNav();
  const { roles } = usePoIdentity();
  const caps = venueCapabilities(roles);
  const callerIsAdmin = roles.includes('admin');

  const team = usePoTeam();
  const invitesQ = usePoInvites();
  const crewQ = usePoVenueCrew();
  const eventsQ = usePoEvents();
  const inviteUser = usePoInviteUser();
  const inviteCrew = usePoInviteExternalCrew();
  const revokeInvite = usePoRevokeInvite();
  const resendInvite = usePoResendInvite();
  const resendCrew = usePoResendCrewInvite();
  const mfa = useMfaGate();

  const [invite, setInvite] = useState(false);
  // Invite fork (86ey21vre): 'choose' = pick Team vs External crew (admins only),
  // then 'team' (venue user) or 'crew' (event-scoped external person).
  const [inviteKind, setInviteKind] = useState<'choose' | 'team' | 'crew'>('choose');
  const [email, setEmail] = useState('');
  // Nothing pre-selected — the inviter chooses the role(s) deliberately (S4.1/S4.2).
  const [inviteRoles, setInviteRoles] = useState<VenueRole[]>([]);
  const [inviteEvents, setInviteEvents] = useState<string[]>([]);
  const [quota, setQuota] = useState('');
  const [sheetMember, setSheetMember] = useState<PoTeamMember | null>(null);

  const resetInviteForm = (): void => {
    setEmail('');
    setInviteRoles([]);
    setInviteEvents([]);
    setQuota('');
  };
  // Soft-block (#32 refinement): no team growth on canceled/lapsed-trial venues.
  const billingLock = useBillingBlocked();
  // Admins choose Team vs External crew; a user_manager can only invite Team.
  const startInvite = (): void => {
    resetInviteForm();
    setInviteKind(callerIsAdmin ? 'choose' : 'team');
    setInvite(true);
  };

  const toggleInviteRole = (r: VenueRole): void =>
    setInviteRoles((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]));
  const toggleInviteEvent = (id: string): void =>
    setInviteEvents((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  // Event-organizer scope is admin-only (mirrors assignOrganizer / the invite RLS),
  // and only upcoming events are sensible to staff up front.
  const upcomingEvents = (eventsQ.data ?? []).filter((e) => e.when === 'upcoming');
  const allEventsSelected = upcomingEvents.length > 0 && inviteEvents.length === upcomingEvents.length;
  const toggleAllEvents = (): void =>
    setInviteEvents(allEventsSelected ? [] : upcomingEvents.map((e) => e.id));
  const sensitive = requiresMfa(inviteRoles);
  const canSubmit = /.+@.+\..+/.test(email) && inviteRoles.length > 0 && !inviteUser.isPending;

  // A member without team-read rights (e.g. plain staff) gets a permission state.
  if (!caps.viewTeam) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.team.title} />
        <Scroll bottom={24}>
          <Empty text={t.settings.team.noRights} />
        </Scroll>
      </div>
    );
  }

  // ── Invite sub-form (fork: choose → team | crew, 86ey21vre) ──
  if (invite) {
    // Step 1 — admin chooser: Venue user (Team) vs External crew.
    if (inviteKind === 'choose') {
      const chooseCard = cn('mb-3 flex w-full items-center gap-[14px] rounded-[18px] border border-line bg-elev p-4 text-left', cardPress);
      const chooseIcon = 'flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] border border-line bg-elev2 text-acc';
      return (
        <div className={col}>
          <Top onBack={() => setInvite(false)} title={t.settings.team.chooseTitle} sub={t.settings.team.chooseSub} />
          <Scroll bottom={24}>
            <button type="button" onClick={() => setInviteKind('team')} className={chooseCard}>
              <span className={chooseIcon}>
                <Icon name="users" size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[16px] font-bold text-text">{t.settings.team.chooseTeamTitle}</span>
                <span className="mt-0.5 block text-[12.5px] leading-[1.4] text-faint">{t.settings.team.chooseTeamSub}</span>
              </span>
              <Icon name="chev" size={18} className="text-ghost" />
            </button>
            <button type="button" onClick={() => setInviteKind('crew')} className={chooseCard}>
              <span className={chooseIcon}>
                <Icon name="spark" size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[16px] font-bold text-text">{t.settings.team.chooseCrewTitle}</span>
                <span className="mt-0.5 block text-[12.5px] leading-[1.4] text-faint">{t.settings.team.chooseCrewSub}</span>
              </span>
              <Icon name="chev" size={18} className="text-ghost" />
            </button>
          </Scroll>
        </div>
      );
    }

    // Step 2a — External crew: email + which events + a guest quota (no roles, no
    // venue membership). Admin-only write (RLS), so no MFA step-up here.
    if (inviteKind === 'crew') {
      const canCrew = /.+@.+\..+/.test(email) && inviteEvents.length > 0 && !inviteCrew.isPending;
      const submitCrew = (): void =>
        inviteCrew.mutate(
          { email: email.trim(), eventIds: inviteEvents, quota: quota === '' ? undefined : Number(quota) },
          {
            onSuccess: () => {
              setInvite(false);
              resetInviteForm();
            },
          },
        );
      return (
        <div className={col}>
          <Top onBack={() => setInviteKind('choose')} title={t.settings.team.crewTitle} />
          <Scroll bottom={130}>
            <Note icon="spark">{t.settings.team.crewIntro}</Note>
            <Label className="mb-2">{t.settings.team.emailLabel}</Label>
            <Field icon="contact" placeholder={t.settings.team.emailPlaceholder} value={email} onChange={setEmail} inputMode="email" autoFocus className="mb-[18px]" />

            <div className="mb-[10px] flex items-center justify-between gap-3">
              <Label>{t.settings.team.crewEventsLabel}</Label>
              {upcomingEvents.length > 0 && (
                <button type="button" onClick={toggleAllEvents} className={cn('shrink-0 font-body text-[12px] font-semibold text-acc', press)}>
                  {allEventsSelected ? t.settings.team.clearSelection : t.settings.team.allEvents}
                </button>
              )}
            </div>
            {eventsQ.isLoading ? (
              <Loading text={t.settings.team.eventsLoading} />
            ) : upcomingEvents.length === 0 ? (
              <div className="rounded-[13px] border border-dashed border-line bg-elev px-[14px] py-[12px] text-[12.5px] text-faint">
                {t.settings.team.noUpcomingEvents}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {upcomingEvents.map((e) => {
                  const on = inviteEvents.includes(e.id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => toggleInviteEvent(e.id)}
                      aria-pressed={on}
                      className={cn(
                        'inline-flex items-center gap-[8px] rounded-[13px] border px-[13px] py-[10px] text-left font-display text-[13px] font-bold',
                        on ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev text-dim',
                        press,
                      )}
                    >
                      <Icon name={on ? 'check' : 'cal'} size={14} sw={2.4} stroke={on ? '#16132B' : undefined} />
                      <span>{e.name}</span>
                      <span className={cn('text-[11px] font-semibold', on ? 'text-on-acc/70' : 'text-faint')}>
                        {e.date} {e.mon}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <Label className="mb-2 mt-[18px]">{t.settings.team.crewQuotaLabel}</Label>
            <Field
              icon="ticket"
              placeholder={t.settings.team.crewQuotaPlaceholder}
              value={quota}
              onChange={(v) => setQuota(v.replace(/[^0-9]/g, '').slice(0, 4))}
              inputMode="numeric"
              className="mb-1.5"
            />
            <div className="pl-0.5 text-[12px] leading-[1.4] text-faint">{t.settings.team.crewQuotaHelp}</div>
            <FormError error={inviteCrew.isError ? inviteCrew.error : null} />
          </Scroll>
          <BottomBar>
            <Btn kind="primary" full icon="arrowR" disabled={!canCrew} onClick={submitCrew} className={canCrew ? '' : 'opacity-[0.45]'}>
              {inviteCrew.isPending ? t.settings.team.sending : t.settings.team.crewSend}
            </Btn>
          </BottomBar>
        </div>
      );
    }

    // Step 2b — Venue user (Team): email + roles + quota. No event scope — a Team
    // member already works every event (86ey21vre).
    const submit = (): void =>
      inviteUser.mutate(
        {
          email: email.trim(),
          roles: inviteRoles,
          defaultQuota: quota === '' ? undefined : Number(quota),
        },
        {
          onSuccess: () => {
            setInvite(false);
            resetInviteForm();
          },
          // AAL1 user → open the MFA step-up sheet and retry the invite after.
          onError: (e) => mfa.guard(e, submit),
        },
      );
    return (
      <div className={col}>
        <Top onBack={() => (callerIsAdmin ? setInviteKind('choose') : setInvite(false))} title={t.settings.team.inviteTitle} />
        <Scroll bottom={130}>
          <Label className="mb-2">{t.settings.team.emailLabel}</Label>
          <Field icon="contact" placeholder={t.settings.team.emailPlaceholder} value={email} onChange={setEmail} inputMode="email" autoFocus className="mb-[18px]" />
          <Label className="mb-[10px]">{t.settings.team.rolesLabel}</Label>
          <RolePicker selected={inviteRoles} toggle={toggleInviteRole} callerIsAdmin={callerIsAdmin} />
          {sensitive && (
            <Note icon="shield">
              {t.settings.team.mfaNotePre}
              <b>{t.settings.team.mfaNoteBold}</b>
              {t.settings.team.mfaNotePost}
            </Note>
          )}

          <Label className="mb-2 mt-[18px]">{t.settings.team.quotaLabel}</Label>
          <Field
            icon="ticket"
            placeholder={t.settings.team.quotaPlaceholder}
            value={quota}
            onChange={(v) => setQuota(v.replace(/[^0-9]/g, '').slice(0, 4))}
            inputMode="numeric"
            className="mb-1.5"
          />
          <div className="pl-0.5 text-[12px] leading-[1.4] text-faint">
            {t.settings.team.quotaHelp}
          </div>
          <FormError error={inviteUser.isError && !isAal2Error(inviteUser.error) ? inviteUser.error : null} />
        </Scroll>
        <BottomBar>
          <Btn kind="primary" full icon="arrowR" disabled={!canSubmit} onClick={submit} className={canSubmit ? '' : 'opacity-[0.45]'}>
            {inviteUser.isPending ? t.settings.team.sending : t.settings.team.sendInvite}
          </Btn>
        </BottomBar>
        {mfa.sheet}
      </div>
    );
  }

  // ── List view ──
  const teamCount = team.data?.length ?? 0;
  const crewCount = crewQ.data?.length ?? 0;
  const inviteCount = invitesQ.data?.length ?? 0;
  // "Open" in the header = not yet accepted (the list itself also shows
  // accepted invites, with their status, per T8).
  const openInviteCount = (invitesQ.data ?? []).filter((iv) => iv.status !== 'accepted').length;
  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={t.settings.team.title}
        sub={fmt(teamCount === 1 ? t.settings.team.subOne : t.settings.team.subMany, { count: teamCount, open: openInviteCount })}
        right={caps.manageTeam && !billingLock.blocked ? <IconBtn name="plus" onClick={startInvite} /> : undefined}
      />
      <Scroll bottom={24}>
        {caps.manageTeam && billingLock.blocked && (
          <Note icon="warn">
            {billingLock.reason === 'canceled'
              ? t.settings.billing.blockedCanceled
              : t.settings.billing.blockedTrial}{' '}
            <button
              type="button"
              className="cursor-pointer font-bold text-acc underline underline-offset-2"
              onClick={() => nav.push('billing')}
            >
              {t.settings.billing.blockedCta}
            </button>
          </Note>
        )}
        {(caps.manageTeam || caps.viewQuota) && (
          <div className="lg:mb-[18px] lg:flex lg:gap-3">
            {caps.manageTeam && !billingLock.blocked && (
              <Btn kind="dark" full icon="plus" className="mb-3 lg:mb-0 lg:w-auto" onClick={startInvite}>
                {t.settings.team.inviteCta}
              </Btn>
            )}
            {caps.viewQuota && (
              <Btn kind="ghost" full icon="ticket" className="mb-[18px] lg:mb-0 lg:w-auto" onClick={() => nav.push('rollen')}>
                {t.settings.team.quotaPerMember}
              </Btn>
            )}
          </div>
        )}
        <Label className="mb-[10px]">{t.settings.team.teamLabel}</Label>
        {team.isLoading ? (
          <Loading />
        ) : team.isError ? (
          <Empty text={t.settings.team.teamLoadError} />
        ) : teamCount === 0 ? (
          <Empty text={t.settings.team.teamEmpty} />
        ) : (
          <div className="mb-5 flex flex-col gap-[9px] lg:grid lg:grid-cols-2 lg:gap-[10px]">
            {(team.data ?? []).map((tm) => {
              const rowInner = (
                <>
                  <Avatar name={tm.name} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[15px] font-bold text-text">{tm.name}</div>
                    <div className="mt-0.5 text-[12px] text-faint">
                      {tm.rolesLabel} · {fmt(t.settings.team.memberQuota, { n: tm.quota })}
                    </div>
                  </div>
                  {caps.manageTeam && (
                    <span className="inline-flex items-center gap-1 rounded-[9px] border border-line2 px-2 py-[5px] font-body text-[12px] font-semibold text-dim">
                      {t.settings.team.manage}
                      <Icon name="chev" size={15} />
                    </span>
                  )}
                </>
              );
              return caps.manageTeam ? (
                <button
                  key={tm.userId}
                  type="button"
                  onClick={() => setSheetMember(tm)}
                  className={cn('flex items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[13px] text-left', cardPress)}
                  aria-label={fmt(t.settings.team.manageAria, { name: tm.name })}
                >
                  {rowInner}
                </button>
              ) : (
                <div key={tm.userId} className="flex items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[13px]">
                  {rowInner}
                </div>
              );
            })}
          </div>
        )}
        {/* External crew — event-scoped people, venue-wide (T8). Read for every
            viewTeam role; the resend is admin-only, mirroring all crew writes. */}
        <Label className="mb-[10px]">{t.settings.team.crewLabel}</Label>
        {crewQ.isLoading ? (
          <Loading />
        ) : crewQ.isError ? (
          <Empty text={t.settings.team.crewLoadError} />
        ) : crewCount === 0 ? (
          <Empty text={t.settings.team.crewEmpty} />
        ) : (
          <div className="mb-5 flex flex-col gap-[9px] lg:grid lg:grid-cols-2 lg:gap-[10px]">
            {(crewQ.data ?? []).map((cm) => {
              const busy = resendCrew.isPending && resendCrew.variables === cm.userId;
              const sent = resendCrew.isSuccess && resendCrew.variables === cm.userId;
              return (
                <div key={cm.userId} className="flex items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[13px]">
                  <Avatar name={cm.name} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[15px] font-bold text-text">{cm.name}</div>
                    <div className="mt-0.5 truncate text-[12px] text-faint">
                      {fmt(t.settings.team.crewOn, { events: cm.eventsLabel })}
                    </div>
                    {!cm.hasAccepted && (
                      <div className="mt-0.5 text-[12px] font-semibold text-acc">{t.settings.team.crewPending}</div>
                    )}
                  </div>
                  {!cm.hasAccepted && callerIsAdmin && (
                    <MiniChip onClick={() => resendCrew.mutate(cm.userId)}>
                      {busy ? t.settings.team.resending : sent ? t.settings.team.resent : t.settings.team.resend}
                    </MiniChip>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <FormError error={resendCrew.isError ? resendCrew.error : null} />

        <Label className="mb-[10px] mt-5">{t.settings.team.invitesLabel}</Label>
        {invitesQ.isLoading ? (
          <Loading />
        ) : inviteCount === 0 ? (
          <Empty text={t.settings.team.invitesEmpty} />
        ) : (
          <div className="flex flex-col gap-[9px] lg:grid lg:grid-cols-2 lg:gap-[10px]">
            {(invitesQ.data ?? []).map((iv) => {
              const accepted = iv.status === 'accepted';
              const resendBusy = resendInvite.isPending && resendInvite.variables === iv.id;
              const resendDone = resendInvite.isSuccess && resendInvite.variables === iv.id;
              return (
                <div key={iv.id} className="flex items-center gap-[12px] rounded-[16px] border border-dashed border-line bg-elev p-[13px]">
                  <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[13px] border border-line bg-elev2 text-faint">
                    <Icon name={accepted ? 'check' : 'contact'} size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="overflow-hidden text-ellipsis whitespace-nowrap font-body text-[14px] font-semibold text-text">{iv.email}</div>
                    <div className="mt-0.5 text-[12px] text-faint">
                      {iv.status === 'expired' && (
                        <span className="font-semibold text-red-300">{t.settings.team.statusExpired} · </span>
                      )}
                      {fmt(t.settings.team.invitedRoles, { roles: iv.rolesLabel, when: iv.sentAt })}
                    </div>
                  </div>
                  {accepted ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-[9px] border border-acc/40 bg-acc/10 px-2 py-[5px] font-body text-[12px] font-semibold text-acc">
                      <Icon name="check" size={13} sw={2.6} />
                      {t.settings.team.statusAccepted}
                    </span>
                  ) : (
                    caps.manageTeam && (
                      <div className="flex shrink-0 items-center gap-[6px]">
                        <MiniChip onClick={() => resendInvite.mutate(iv.id)}>
                          {resendBusy ? t.settings.team.resending : resendDone ? t.settings.team.resent : t.settings.team.resend}
                        </MiniChip>
                        <MiniChip
                          onClick={() => {
                            // AAL1 → open the MFA step-up sheet and retry the revoke after.
                            const doRevoke = (): void =>
                              revokeInvite.mutate(iv.id, { onError: (e) => mfa.guard(e, doRevoke) });
                            doRevoke();
                          }}
                        >
                          {revokeInvite.isPending && revokeInvite.variables === iv.id ? t.settings.team.revoking : t.settings.team.revoke}
                        </MiniChip>
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
        <FormError error={revokeInvite.isError && !isAal2Error(revokeInvite.error) ? revokeInvite.error : null} />
        <FormError error={resendInvite.isError ? resendInvite.error : null} />
      </Scroll>
      {sheetMember && <MemberSheet member={sheetMember} callerRoles={roles} onClose={() => setSheetMember(null)} />}
      {mfa.sheet}
    </div>
  );
}

// Member action sheet: edit roles or revoke venue access. Both writes go through
// the AAL2 + escalation + last-admin guarded venues actions; the sheet only
// offers controls the caller may use and surfaces the action's copy on refusal.
function MemberSheet({
  member,
  callerRoles,
  onClose,
}: {
  member: PoTeamMember;
  callerRoles: VenueRole[];
  onClose: () => void;
}): JSX.Element {
  const updateRoles = usePoUpdateMemberRoles();
  const removeMember = usePoRemoveMember();
  const mfa = useMfaGate();
  const [roles, setRoles] = useState<VenueRole[]>(member.roles);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const callerIsAdmin = callerRoles.includes('admin');
  const canManageThis = canGrantRoles(callerRoles, member.roles);
  const toggle = (r: VenueRole): void => setRoles((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]));
  const busy = updateRoles.isPending || removeMember.isPending;
  const saveRoles = (): void =>
    updateRoles.mutate({ userId: member.userId, roles }, { onSuccess: onClose, onError: (e) => mfa.guard(e, saveRoles) });
  const doRemove = (): void =>
    removeMember.mutate(member.userId, { onSuccess: onClose, onError: (e) => mfa.guard(e, doRemove) });
  const err =
    updateRoles.isError && !isAal2Error(updateRoles.error)
      ? updateRoles.error
      : removeMember.isError && !isAal2Error(removeMember.error)
        ? removeMember.error
        : null;

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-4 flex items-center gap-[12px]">
        <Avatar name={member.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[16px] font-bold text-text">{member.name}</div>
          <div className="truncate text-[12px] text-faint">{member.email}</div>
        </div>
      </div>

      {!canManageThis ? (
        <Note icon="shield">{t.settings.team.sheetNoRights}</Note>
      ) : confirmRemove ? (
        <>
          <Note icon="warn">
            <b>{fmt(t.settings.team.removeConfirmBold, { name: member.name })}</b>
            {t.settings.team.removeConfirmPost}
          </Note>
          <FormError error={err} />
          <Btn kind="primary" full icon="warn" className="mt-2" disabled={busy} onClick={doRemove}>
            {removeMember.isPending ? t.settings.team.removing : t.settings.team.removeConfirmBtn}
          </Btn>
          <Btn kind="ghost" full className="mt-2" onClick={() => setConfirmRemove(false)}>
            {t.settings.common.cancel}
          </Btn>
        </>
      ) : (
        <>
          <Label className="mb-[10px]">{t.settings.team.sheetRolesLabel}</Label>
          <RolePicker selected={roles} toggle={toggle} callerIsAdmin={callerIsAdmin} />
          <FormError error={err} />
          <Btn
            kind="primary"
            full
            icon="check"
            className={cn('mt-4', roles.length === 0 && 'opacity-[0.45]')}
            disabled={roles.length === 0 || busy}
            onClick={saveRoles}
          >
            {updateRoles.isPending ? t.settings.team.savingRoles : t.settings.team.saveRoles}
          </Btn>
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className={cn('mt-3 w-full cursor-pointer border-none bg-transparent text-center font-body text-[13px] font-semibold text-faint', press)}
          >
            {t.settings.team.removeAccess}
          </button>
        </>
      )}
      {mfa.sheet}
    </Sheet>
  );
}
