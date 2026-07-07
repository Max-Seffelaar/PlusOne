'use client';

/** Settings cluster: Meer (hub), gebruikers/rollen, toelage, venue switch/beheer,
 *  persoonlijke gegevens + sessies, abonnement & facturen, importeren. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/client';
import { account, allowance as allowanceData } from '@/lib/po/data';
import type { Venue } from '@/lib/po/types';
import { VENUE_ROLES, ROLE_LABELS, canGrantRoles, canWorkDoor, requiresMfa, type VenueRole } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import {
  parseCsv,
  parsePastedList,
  dedupeWithin,
  normalizeEmail,
  normalizePhoneToDigits,
  normalizeImportPhone,
  normalizeImportBirthdate,
  csvFirstRowIsHeader,
} from '@/features/contacts/import/parse';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import {
  usePoTeam,
  usePoInvites,
  usePoVenueCrew,
  usePoSessions,
  usePoProfile,
  usePoVenueSettings,
  usePoSubscription,
  usePoContactKeys,
  usePoEvents,
  usePoCanManageTemplates,
  usePoGuestRequests,
  useBillingBlocked,
} from '@/features/po/hooks';
import {
  usePoInviteUser,
  usePoInviteExternalCrew,
  usePoRevokeInvite,
  usePoResendInvite,
  usePoResendCrewInvite,
  usePoUpdateMemberRoles,
  usePoRemoveMember,
  usePoSetDefaultQuota,
  usePoUpdateProfile,
  usePoUpdateEmail,
  usePoRevokeOwnSession,
  usePoUpdateVenueSettings,
  usePoImportContacts,
  usePoBillingCheckout,
  usePoBillingPortal,
} from '@/features/po/mutations';
import { groupPoSessions, isOpenGuestRequest, type PoSubscription, type PoTeamMember } from '@/features/po/adapters';
import { useMfaGate, isAal2Error, PoMfaSheet } from '../mfa-gate';
import { isNativeShell } from '@/lib/platform';
import PhoneInput from 'react-phone-number-input/input';
import { parsePhoneNumber } from 'react-phone-number-input';
import { clearNavState, useNav, usePo } from '../context';
import { Icon, type IconName } from '../icon';
import { Avatar, Btn, Empty, Field, IconBtn, Label, Loading, MiniChip, Note, Row, Scroll, ToggleRow, Top } from '../kit';
import { BottomBar, Sheet } from '../shell';
import { CountrySelect, type CountryCode } from '../country-select';

function countryFromE164(phone: string | null | undefined): CountryCode {
  if (!phone) return 'NL';
  try { return (parsePhoneNumber(phone)?.country as CountryCode | undefined) ?? 'NL'; }
  catch { return 'NL'; }
}

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';
const col = 'flex h-full flex-col';
const iconSm = 'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-line text-faint';

/** Real sign-out (T1 #7/#15): drop the user's persisted nav-state, end the
 *  Supabase session, land on /login. NB: supabase-js signOut() DEFAULTS to
 *  scope 'global' — 'local' must be explicit for the this-device variant.
 *  'global' revokes every session server-side = true "log out everywhere". */
async function signOutDevice(userId: string, scope: 'local' | 'global'): Promise<void> {
  clearNavState(userId);
  await createClient().auth.signOut({ scope });
  window.location.assign('/login');
}

/** Inline action error, matching the desktop forms' `text-red-300` treatment. */
function FormError({ error }: { error: unknown }): JSX.Element | null {
  if (!error) return null;
  const msg = error instanceof Error && error.message ? error.message : t.settings.common.formError;
  return (
    <p className="mt-3 text-[12.5px] leading-[1.45] text-red-300" role="alert">
      {msg}
    </p>
  );
}

/** Role multi-select as selectable chips (design language: lavender pill when on,
 *  same pattern as the import-source toggles), shared by the invite form and the
 *  member sheet. Only an admin may toggle `admin` (mirrors the escalation guard /
 *  RLS); a blocked chip dims and shows why. */
function RolePicker({
  selected,
  toggle,
  callerIsAdmin,
}: {
  selected: VenueRole[];
  toggle: (r: VenueRole) => void;
  callerIsAdmin: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {VENUE_ROLES.map((k) => {
        const on = selected.includes(k);
        const blocked = k === 'admin' && !callerIsAdmin;
        return (
          <button
            key={k}
            type="button"
            disabled={blocked}
            onClick={() => toggle(k)}
            aria-pressed={on}
            className={cn(
              'inline-flex items-center gap-[7px] rounded-full border px-[15px] py-[10px] font-display text-[13.5px] font-bold',
              on ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev text-dim',
              blocked ? 'opacity-40' : press,
            )}
          >
            {on && <Icon name="check" size={14} stroke="#16132B" sw={2.6} />}
            {ROLE_LABELS[k]}
            {blocked && <span className="ml-0.5 text-[10px] font-bold opacity-70">· {t.settings.common.adminOnly}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── MEER (settings tab) ──────────────────────────────────────────────────────
export function Meer(): JSX.Element {
  const nav = useNav();
  const { venue, statsVenues, myVenues } = usePo();
  const { userId, venueName, roles } = usePoIdentity();
  const [signingOut, setSigningOut] = useState(false);
  const caps = venueCapabilities(roles);
  const isAdmin = roles.includes('admin');
  const isFinance = roles.includes('finance');
  const canManageTemplates = usePoCanManageTemplates();
  const canViewStats = statsVenues.length > 0;
  // Only surface destinations the member can actually use, so an external-crew /
  // organizer (roles:[]) sees just their accessible items instead of a wall of
  // "no rights" rows (S6 feedback). RLS stays the real boundary; these mirror each
  // target screen's own gate. canManageTemplates = admin OR organizer-at-venue.
  const showRequests = isAdmin || canManageTemplates;
  // Open-requests count for the row badge — same source + shared definition as the
  // More-tab badge and Home tile, so the count matches everywhere (T9). This makes
  // the tab's "2" legible: it points at THIS row.
  const openRequestCount = (usePoGuestRequests().data ?? []).filter(isOpenGuestRequest).length;
  const showEvents = isAdmin || canManageTemplates;
  const showContacts = caps.viewSettings || canManageTemplates;
  const showImport = isAdmin || isFinance;
  const showRegulars = isAdmin || isFinance;
  const showCockpit = canWorkDoor(roles);
  const insightsAny = showCockpit || canViewStats || caps.viewAudit || showRequests;
  const thisVenueAny =
    showEvents || canManageTemplates || caps.viewSettings || caps.viewQuota || showRegulars || showContacts || showImport;
  const teamAny = caps.viewTeam || isAdmin;
  const profile = usePoProfile();
  const subQ = usePoSubscription();
  const v = venue;
  // Live active-venue name + plan for the header card; the switcher is now wired to
  // the caller's real memberships (usePo().myVenues), not the mock prototype data.
  const displayVenue = venueName ?? v.name;
  const planLabel = subQ.data?.plan ?? null;
  const billingSub = subQ.data
    ? subQ.data.priceLabel.startsWith('€')
      ? `${subQ.data.plan} · ${subQ.data.priceLabel}/${subQ.data.period}`
      : subQ.data.plan
    : t.settings.more.billingDefault;
  return (
    <div className={col}>
      <Top big title={t.settings.more.title} onBack={nav.canGoBack ? nav.back : undefined} />
      <Scroll bottom={100}>
        <button type="button" onClick={() => nav.push('venueswitch')} className={cn('mb-5 flex w-full items-center gap-[14px] rounded-[18px] border border-line bg-elev p-4 text-left', cardPress)}>
          <Avatar name={displayVenue} size={48} accent />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[18px] font-bold text-text">{displayVenue}</div>
            <div className="text-[12.5px] text-faint">{fmt(t.settings.more.switchSub, { name: profile.data?.name ?? account.user })}</div>
          </div>
          <span className="inline-flex items-center gap-[7px]">
            {planLabel && (
              <span className="rounded-full bg-acc px-[11px] py-[5px] font-display text-[11px] font-bold text-on-acc">{planLabel}</span>
            )}
            <span className="text-ghost">
              <Icon name="swap" size={18} />
            </span>
          </span>
        </button>
        <Label className="mb-1">{t.sections.account}</Label>
        <Row icon="user" title={t.settings.more.profileTitle} sub={t.settings.more.profileSub} onClick={() => nav.push('profile')} />

        {insightsAny && <Label className="mb-1 mt-[22px]">{t.sections.insights}</Label>}
        {showCockpit && (
          <Row icon="flag" title={t.settings.more.cockpitTitle} sub={t.settings.more.cockpitSub} onClick={() => nav.setTab('deur')} accent />
        )}
        {canViewStats && (
          <Row icon="spark" title={t.settings.more.analyticsTitle} sub={t.settings.more.analyticsSub} onClick={() => nav.push('stats')} accent />
        )}
        {canViewStats && (
          <Row icon="link" title={t.settings.more.promoTitle} sub={t.settings.more.promoSub} onClick={() => nav.push('promo')} accent />
        )}
        {caps.viewAudit && (
          <Row icon="history" title={t.settings.more.auditTitle} sub={t.settings.more.auditSub} onClick={() => nav.push('audit')} accent />
        )}
        {showRequests && (
          <Row
            icon="bell"
            title={t.settings.more.requestsTitle}
            sub={t.settings.more.requestsSub}
            onClick={() => nav.push('aanvragen')}
            accent
            right={
              openRequestCount > 0 ? (
                <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-acc px-[7px] font-display text-[12px] font-extrabold text-on-acc">
                  {openRequestCount}
                </span>
              ) : undefined
            }
          />
        )}

        {thisVenueAny && <Label className="mb-1 mt-[22px]">{t.sections.thisVenue}</Label>}
        {showEvents && (
          <Row icon="cal" title={t.settings.more.eventsTitle} sub={t.settings.more.eventsSub} onClick={() => nav.push('eventbeheer')} />
        )}
        {canManageTemplates && (
          <Row icon="grid" title={t.settings.more.templatesTitle} sub={t.settings.more.templatesSub} onClick={() => nav.push('templates')} />
        )}
        {caps.viewSettings && (
          <Row icon="cog" title={t.settings.more.venueSettingsTitle} sub={t.settings.more.venueSettingsSub} onClick={() => nav.push('venuesettings')} />
        )}
        {caps.viewQuota && (
          <Row icon="ticket" title={t.settings.more.quotaTitle} sub={t.settings.more.quotaSub} onClick={() => nav.push('allowance')} />
        )}
        {showRegulars && (
          <Row icon="star" title={t.settings.more.regularsTitle} sub={t.settings.more.regularsSub} onClick={() => nav.push('vaste')} accent />
        )}
        {isAdmin && (
          <Row icon="link" title={t.settings.more.influencersTitle} sub={t.settings.more.influencersSub} onClick={() => nav.push('influencers')} />
        )}
        {showContacts && (
          <Row icon="contact" title={t.settings.more.contactsTitle} sub={t.settings.more.contactsSub} onClick={() => nav.push('contacten')} accent />
        )}
        {showImport && (
          <Row icon="upload" title={t.settings.more.importTitle} sub={t.settings.more.importSub} onClick={() => nav.push('import')} />
        )}
        {caps.viewSettings && (
          <Row icon="spark" title={t.settings.more.billingTitle} sub={billingSub} onClick={() => nav.push('billing')} accent right={<Icon name="chev" size={18} className="text-ghost" />} />
        )}

        {teamAny && <Label className="mb-1 mt-[22px]">{t.sections.teamAccess}</Label>}
        {caps.viewTeam && (
          <Row icon="users" title={t.settings.more.teamTitle} sub={t.settings.more.teamSub} onClick={() => nav.push('gebruikers')} accent />
        )}
        {isAdmin && (
          <Row icon="lock" title={t.settings.more.sessionsTitle} sub={t.settings.more.sessionsSub} onClick={() => nav.push('adminsessions')} />
        )}

        <Label className="mb-1 mt-[22px]">{t.sections.switchVenue}</Label>
        <Row icon="building" title={t.settings.more.venuesTitle} sub={fmt(myVenues.length === 1 ? t.settings.more.venuesSubOne : t.settings.more.venuesSubMany, { n: myVenues.length })} onClick={() => nav.push('venueswitch')} />

        <div className="mt-[22px]">
          <Row
            icon="logout"
            title={signingOut ? t.settings.profile.signingOut : t.settings.profile.signOut}
            sub={t.settings.profile.signOutSub}
            onClick={() => {
              if (signingOut) return;
              setSigningOut(true);
              void signOutDevice(userId, 'local');
            }}
          />
        </div>
      </Scroll>
    </div>
  );
}

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
export function Allowance(): JSX.Element {
  const nav = useNav();
  const [rows, setRows] = useState(allowanceData.rows.map((r) => ({ ...r })));
  const set = (name: string, v: number): void => setRows((rs) => rs.map((r) => (r.name === name ? { ...r, override: Math.max(0, v) } : r)));
  const stepBtn = cn('flex h-[46px] w-[46px] items-center justify-center rounded-[14px] border border-line bg-elev2 text-text', press);
  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.settings.quota.allowanceTitle} sub={allowanceData.event} right={<IconBtn name="cal" />} />
      <Scroll bottom={120}>
        <Note icon="ticket">
          {t.settings.quota.allowanceNotePre}
          <b>{t.settings.quota.allowanceNoteBold}</b>
          {t.settings.quota.allowanceNotePost}
        </Note>
        <Label className="mb-[10px]">{fmt(t.settings.quota.allowanceMembers, { event: allowanceData.event })}</Label>
        <div className="flex flex-col gap-[10px]">
          {rows.map((r) => {
            const changed = r.override !== r.base;
            return (
              <div key={r.name} className="rounded-[18px] border border-line bg-elev p-[14px]">
                <div className="mb-3 flex items-center gap-[12px]">
                  <Avatar name={r.name} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[15px] font-bold text-text">{r.name}</div>
                    <div className="text-[12px] text-faint">
                      {r.role} · {fmt(t.settings.quota.allowanceDefault, { n: r.base })}
                    </div>
                  </div>
                  {changed && <MiniChip className="border-transparent bg-acc-dim text-acc">{r.override > r.base ? fmt(t.settings.quota.overridePlus, { n: r.override - r.base }) : fmt(t.settings.quota.overrideMinus, { n: r.override - r.base })}</MiniChip>}
                </div>
                <div className="flex items-center justify-between gap-[14px] rounded-[16px] bg-acc-dim p-[9px]">
                  <button type="button" onClick={() => set(r.name, r.override - 1)} className={stepBtn} aria-label={t.settings.quota.less}>
                    <Icon name="minus" size={20} sw={2.4} />
                  </button>
                  <div className="text-center">
                    <div className="font-display text-[26px] font-extrabold leading-none text-text">{r.override}</div>
                    <div className="mt-0.5 text-[11px] text-dim">{t.settings.quota.spots}</div>
                  </div>
                  <button type="button" onClick={() => set(r.name, r.override + 1)} className={stepBtn} aria-label={t.settings.quota.more}>
                    <Icon name="plus" size={20} sw={2.4} stroke="#B5A6FF" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="check" onClick={() => nav.back()}>
          {t.settings.quota.saveAllowance}
        </Btn>
      </BottomBar>
    </div>
  );
}

// ── VENUE SWITCHER (pushed) ──────────────────────────────────────────────────
export function VenueSwitch(): JSX.Element {
  const nav = useNav();
  const { myVenues, activeVenueId, switchToVenue } = usePo();
  const activeName = myVenues.find((v) => v.venueId === activeVenueId)?.venueName ?? t.settings.venueSwitch.thisVenueFallback;
  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.settings.venueSwitch.title} sub={t.settings.venueSwitch.sub} right={<IconBtn name="plus" onClick={() => nav.push('venuecreate')} />} />
      <Scroll bottom={24}>
        <Note icon="building">
          {t.settings.venueSwitch.notePre}
          <b>{fmt(t.settings.venueSwitch.noteBold, { name: activeName })}</b>
          {t.settings.venueSwitch.notePost}
        </Note>
        <Label className="mb-[10px]">{fmt(t.settings.venueSwitch.yourVenues, { n: myVenues.length })}</Label>
        {myVenues.length === 0 ? (
          <Empty text={t.settings.venueSwitch.empty} />
        ) : (
          <div className="flex flex-col gap-[10px]">
            {myVenues.map((v) => {
              const cur = v.venueId === activeVenueId;
              return (
                <div key={v.venueId} className={cn('rounded-[18px] border p-[15px]', cur ? 'border-transparent bg-acc-dim' : 'border-line bg-elev')}>
                  <div className="flex items-center gap-[13px]">
                    <Avatar name={v.venueName} size={46} accent={cur} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-display text-[16.5px] font-bold text-text">{v.venueName}</div>
                        {cur && <MiniChip className="border-transparent bg-white/[0.10] text-acc">{t.settings.venueSwitch.current}</MiniChip>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {v.roles.length > 0 ? (
                          v.roles.map((ro) => <MiniChip key={ro}>{ROLE_LABELS[ro] ?? ro}</MiniChip>)
                        ) : (
                          <MiniChip>{t.settings.venueSwitch.crewAccess}</MiniChip>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-[13px] flex items-center justify-end gap-[7px]">
                    {cur ? (
                      <Btn sm kind="ghost" icon="cog" onClick={() => nav.push('venuesettings', { id: v.venueId })}>
                        {t.settings.venueSwitch.manage}
                      </Btn>
                    ) : (
                      <Btn sm kind="primary" icon="swap" onClick={() => switchToVenue(v.venueId)}>
                        {t.settings.venueSwitch.switch}
                      </Btn>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <Btn kind="dark" full icon="plus" className="mt-[14px]" onClick={() => nav.push('venuecreate')}>
          {t.settings.venueSwitch.addVenue}
        </Btn>
      </Scroll>
    </div>
  );
}

// ── VENUE SETTINGS (pushed) — S8 Venue-instellingen, live ────────────────────
// Name + AVG retention + venue-default quota + the company/legal/finance/address
// profile (mirrors the desktop VenueSettingsForm). Admin edits; finance reads
// (RLS venues_update_admin). The action re-checks admin server-side.
export function VenueSettings({ venue }: { venue: Venue }): JSX.Element {
  const nav = useNav();
  const { roles, venueName } = usePoIdentity();
  const caps = venueCapabilities(roles);
  const settingsQ = usePoVenueSettings();
  const save = usePoUpdateVenueSettings();

  const s = settingsQ.data ?? null;
  const [form, setForm] = useState({
    name: '',
    retentionMonths: 12,
    defaultPersonalQuota: 0,
    allowUncheck: true,
    companyName: '',
    kvkNumber: '',
    vatNumber: '',
    financeEmail: '',
    addressLine: '',
    postalCode: '',
    city: '',
    country: 'NL',
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (s && !loaded) {
      setForm({
        name: s.name,
        retentionMonths: s.retentionMonths,
        defaultPersonalQuota: s.defaultPersonalQuota,
        allowUncheck: s.allowUncheck,
        companyName: s.companyName,
        kvkNumber: s.kvkNumber,
        vatNumber: s.vatNumber,
        financeEmail: s.financeEmail,
        addressLine: s.addressLine,
        postalCode: s.postalCode,
        city: s.city,
        country: s.country,
      });
      setLoaded(true);
    }
  }, [s, loaded]);

  const canEdit = caps.editSettings;
  type StrField = 'name' | 'companyName' | 'kvkNumber' | 'vatNumber' | 'financeEmail' | 'addressLine' | 'postalCode' | 'city' | 'country';
  const editStr = (k: StrField, sanitize?: (v: string) => string) =>
    canEdit ? (v: string) => setForm((f) => ({ ...f, [k]: sanitize ? sanitize(v) : v })) : undefined;

  if (!caps.viewSettings) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.venue.title} sub={venueName ?? venue.name} />
        <Scroll bottom={24}>
          <Empty text={t.settings.venue.viewNoRights} />
        </Scroll>
      </div>
    );
  }
  if ((settingsQ.isLoading || !loaded) && !settingsQ.isError) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.venue.title} sub={venueName ?? venue.name} />
        <Scroll bottom={24}>
          <Empty text={t.settings.venue.loading} />
        </Scroll>
      </div>
    );
  }
  if (!s) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.venue.title} sub={venueName ?? venue.name} />
        <Scroll bottom={24}>
          <Empty text={t.settings.venue.loadError} />
        </Scroll>
      </div>
    );
  }

  const dirty =
    form.name !== s.name ||
    form.retentionMonths !== s.retentionMonths ||
    form.defaultPersonalQuota !== s.defaultPersonalQuota ||
    form.allowUncheck !== s.allowUncheck ||
    form.companyName !== s.companyName ||
    form.kvkNumber !== s.kvkNumber ||
    form.vatNumber !== s.vatNumber ||
    form.financeEmail !== s.financeEmail ||
    form.addressLine !== s.addressLine ||
    form.postalCode !== s.postalCode ||
    form.city !== s.city ||
    form.country !== s.country;
  const canSave = canEdit && dirty && form.name.trim() !== '' && !save.isPending;

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.settings.venue.title} sub={s.name} />
      <Scroll bottom={canEdit ? 120 : 28}>
        {!canEdit && <Note icon="shield">{t.settings.venue.readonlyNote}</Note>}

        <Label className="mb-2">{t.settings.venue.nameLabel}</Label>
        <Field icon="building" value={form.name} onChange={editStr('name')} className="mb-[14px]" />
        <Label className="mb-2">{t.settings.venue.landingLabel}</Label>
        <Field icon="link" value={`plus.one/${s.slug}`} className="mb-[18px]" />

        <Label className="mb-[10px]">{t.settings.venue.defaultsLabel}</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-4 py-1">
          <div className="flex items-center gap-[12px] py-[14px]">
            <div className="flex-1">
              <div className="text-[14.5px] font-semibold text-text">{t.settings.venue.defaultQuotaTitle}</div>
              <div className="mt-0.5 text-[12px] text-faint">{t.settings.venue.defaultQuotaSub}</div>
            </div>
            {canEdit ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setForm((f) => ({ ...f, defaultPersonalQuota: Math.max(0, f.defaultPersonalQuota - 1) }))} className={cn(iconSm, press)} aria-label={t.settings.quota.less}>
                  <Icon name="minus" size={16} />
                </button>
                <span className="min-w-[22px] text-center font-display text-[18px] font-extrabold text-text">{form.defaultPersonalQuota}</span>
                <button type="button" onClick={() => setForm((f) => ({ ...f, defaultPersonalQuota: f.defaultPersonalQuota + 1 }))} className={cn(iconSm, press, 'text-acc')} aria-label={t.settings.quota.more}>
                  <Icon name="plus" size={16} />
                </button>
              </div>
            ) : (
              <span className="font-display text-[18px] font-extrabold text-text">{form.defaultPersonalQuota}</span>
            )}
          </div>
        </div>

        <Label className="mb-[10px]">{t.settings.venue.atDoorLabel}</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-4 py-1">
          <ToggleRow
            title={t.settings.venue.allowCheckoutTitle}
            sub={t.settings.venue.allowCheckoutSub}
            on={form.allowUncheck}
            set={(v) => canEdit && setForm((f) => ({ ...f, allowUncheck: v }))}
            last
          />
        </div>

        <Label className="mb-[10px]">{t.settings.venue.retentionLabel}</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev p-4">
          <div className="mb-[14px] text-[13.5px] leading-[1.5] text-dim">{t.settings.venue.retentionNote}</div>
          <div className="flex gap-[7px]">
            {[6, 12, 24].map((m) => (
              <button
                key={m}
                type="button"
                disabled={!canEdit}
                onClick={() => setForm((f) => ({ ...f, retentionMonths: m }))}
                className={cn(
                  'flex-1 rounded-[11px] border py-[11px] font-display text-[14px] font-bold',
                  canEdit && press,
                  form.retentionMonths === m ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev2 text-dim',
                )}
              >
                {fmt(t.settings.venue.retentionMonths, { n: m })}
              </button>
            ))}
          </div>
        </div>

        <Label className="mb-[10px]">{t.settings.venue.companyLabel}</Label>
        <Field icon="building" value={form.companyName} onChange={editStr('companyName')} placeholder={t.settings.venue.companyNamePlaceholder} className="mb-[14px]" />
        {/* min-w-0 lets each field shrink below its content so the 2-col row never
            overflows the viewport at ≤390px (the btw-nummer overflow, S4.2). */}
        <div className="mb-[14px] flex gap-2">
          <Field icon="grid" value={form.kvkNumber} onChange={editStr('kvkNumber', (v) => v.replace(/[^0-9]/g, '').slice(0, 8))} inputMode="numeric" placeholder={t.settings.venue.kvkPlaceholder} className="min-w-0 flex-1" />
          <Field value={form.vatNumber} onChange={editStr('vatNumber')} placeholder={t.settings.venue.vatPlaceholder} className="min-w-0 flex-1" />
        </div>
        <Field icon="mail" value={form.financeEmail} onChange={editStr('financeEmail')} inputMode="email" placeholder={t.settings.venue.billingEmailPlaceholder} className="mb-[18px]" />

        <Label className="mb-[10px]">{t.settings.venue.addressLabel}</Label>
        <Field icon="pin" value={form.addressLine} onChange={editStr('addressLine')} placeholder={t.settings.venue.streetPlaceholder} className="mb-[14px]" />
        <div className="mb-[14px] flex gap-2">
          <Field value={form.postalCode} onChange={editStr('postalCode')} placeholder={t.settings.venue.postalPlaceholder} className="min-w-0 flex-1" />
          <Field value={form.city} onChange={editStr('city')} placeholder={t.settings.venue.cityPlaceholder} className="min-w-0 flex-[1.4]" />
        </div>
        <Field value={form.country} onChange={editStr('country')} placeholder={t.settings.venue.countryPlaceholder} className="mb-1.5" />

        <FormError error={save.isError ? save.error : null} />
        {save.isSuccess && !dirty && <p className="mt-3 text-[12.5px] text-acc-soft">{t.settings.venue.saved}</p>}
      </Scroll>
      {canEdit && (
        <BottomBar>
          <Btn
            kind="primary"
            full
            icon="check"
            disabled={!canSave}
            className={canSave ? '' : 'opacity-[0.45]'}
            onClick={() => save.mutate(form)}
          >
            {save.isPending ? t.settings.venue.saving : t.settings.venue.save}
          </Btn>
        </BottomBar>
      )}
    </div>
  );
}

// MFA row in the profile's security card (S4.3). MFA is OPTIONAL for every role
// (#20 refinement 2026-07-02): anyone can enable it (reusing the enroll step from
// mfa-gate: QR + 6-digit code) and disable it again. For admin/finance we still
// RECOMMEND it (`recommended`, was `mandatory`) — copy + chip only, never a gate.
// The verified factor is read client-side from GoTrue (Capacitor-safe, #37).
function MfaCard({ recommended }: { recommended: boolean }): JSX.Element {
  const [hasMfa, setHasMfa] = useState<boolean | null>(null); // null = still loading
  const [enroll, setEnroll] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setHasMfa(null);
    void createClient()
      .auth.mfa.listFactors()
      .then(({ data }) =>
        setHasMfa((data?.all ?? []).some((f) => f.factor_type === 'totp' && f.status === 'verified'))
      )
      .catch(() => setHasMfa(false));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Drop every verified TOTP factor. GoTrue requires an AAL2 session to unenroll
  // a verified factor; on failure we surface a retry hint rather than dead-ending.
  async function disable(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = (data?.all ?? []).filter((f) => f.factor_type === 'totp' && f.status === 'verified');
      for (const f of verified) {
        const { error: unErr } = await supabase.auth.mfa.unenroll({ factorId: f.id });
        if (unErr) throw unErr;
      }
      setConfirmDisable(false);
      refresh();
    } catch {
      setError(t.settings.profile.mfaDisableError);
    } finally {
      setBusy(false);
    }
  }

  const on = hasMfa === true;
  const sub = on
    ? t.settings.profile.mfaSubOn
    : recommended
      ? t.settings.profile.mfaSubRecommended
      : t.settings.profile.mfaSubOff;
  const chipLabel =
    hasMfa === null
      ? '…'
      : on
        ? t.settings.profile.mfaChipOn
        : recommended
          ? t.settings.profile.mfaChipRecommended
          : t.settings.profile.mfaChipOff;

  return (
    <div className="flex items-start gap-[12px] border-b border-line2 py-[14px]">
      <span className={cn('mt-px', recommended || on ? 'text-acc' : 'text-faint')}>
        <Icon name="shield" size={19} />
      </span>
      <div className="flex-1">
        <div className="text-[14.5px] font-semibold text-text">{t.settings.profile.mfaTitle}</div>
        <div className="mt-0.5 text-[12px] leading-[1.4] text-faint">{sub}</div>
        {hasMfa !== null && (
          <button
            type="button"
            onClick={() => (on ? setConfirmDisable(true) : setEnroll(true))}
            className={cn('mt-[7px] font-body text-[12.5px] font-bold', press, on ? 'text-faint' : 'text-acc')}
          >
            {on ? t.settings.profile.mfaDisable : t.settings.profile.mfaEnable}
          </button>
        )}
      </div>
      <MiniChip className={cn('border-transparent', recommended || on ? 'bg-acc-dim text-acc' : 'bg-elev2 text-faint')}>
        {chipLabel}
      </MiniChip>

      {enroll && (
        <PoMfaSheet
          title={t.settings.profile.mfaEnrollTitle}
          subtitle={t.settings.profile.mfaEnrollSubtitle}
          onClose={() => setEnroll(false)}
          onVerified={() => {
            setEnroll(false);
            refresh();
          }}
        />
      )}
      {confirmDisable && (
        <Sheet onClose={() => setConfirmDisable(false)} center={false}>
          <Note icon="warn">
            {t.settings.profile.mfaDisableNote}
          </Note>
          {error && (
            <p className="mb-1 text-[12.5px] text-red-300" role="alert">
              {error}
            </p>
          )}
          <Btn kind="primary" full icon="shield" className="mt-2" disabled={busy} onClick={() => void disable()}>
            {busy ? t.settings.profile.mfaDisabling : t.settings.profile.mfaDisableConfirm}
          </Btn>
          <Btn kind="ghost" full className="mt-2" onClick={() => setConfirmDisable(false)}>
            {t.settings.common.cancel}
          </Btn>
        </Sheet>
      )}
    </div>
  );
}

// ── PERSOONLIJKE GEGEVENS (pushed) — S7 Profiel & Sessies, live ──────────────
export function Profile(): JSX.Element {
  const nav = useNav();
  const profileQ = usePoProfile();
  const sessionsQ = usePoSessions();
  const updateProfile = usePoUpdateProfile();
  const updateEmail = usePoUpdateEmail();
  const revokeSession = usePoRevokeOwnSession();

  const p = profileQ.data ?? null;
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState<string | undefined>(undefined);
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>('NL');
  const [email, setEmail] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);
  const [signingOut, setSigningOut] = useState<'local' | 'global' | null>(null);

  // Prefill the editable fields once the profile arrives (and keep them in sync
  // after a save re-fetches the row).
  useEffect(() => {
    if (!p) return;
    if (!loaded) {
      setFirstName(p.firstName);
      setLastName(p.lastName);
      setPhone(p.phone || undefined);
      setPhoneCountry(countryFromE164(p.phone));
      setEmail(p.email);
      setLoaded(true);
    }
  }, [p, loaded]);

  if (profileQ.isLoading || !loaded) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.profile.title} />
        <Scroll bottom={24}>
          <Empty text={profileQ.isError ? t.settings.profile.loadError : t.settings.profile.loading} />
        </Scroll>
      </div>
    );
  }
  if (!p) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.profile.title} />
        <Scroll bottom={24}>
          <Empty text={t.settings.profile.loadError} />
        </Scroll>
      </div>
    );
  }

  const nameChanged = firstName !== p.firstName || lastName !== p.lastName || (phone ?? '') !== p.phone;
  const profileValid = firstName.trim() !== '' && lastName.trim() !== '';
  const emailChanged = email.trim().toLowerCase() !== p.email.toLowerCase();
  const sessions = sessionsQ.data ?? [];
  const current = sessions.find((s) => s.current) ?? null;
  const others = sessions.filter((s) => !s.current);
  // Identical stale sessions (same device + IP) collapse into one row with a
  // count — 12 dev-login rows read as one "Chrome · Windows · 5 sessions".
  const otherGroups = groupPoSessions(others);
  const sessionIcon = (device: string): IconName =>
    /mac|windows|linux/i.test(device) ? 'grid' : 'user';

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.settings.profile.title} />
      <Scroll bottom={130}>
        <div className="flex flex-col items-center px-0 pb-5 pt-1 text-center">
          <Avatar name={p.name || p.email} size={84} accent />
          <h2 className="mb-0 mt-4 font-display text-[26px] font-extrabold tracking-[-0.02em] text-text">{p.name || t.settings.profile.noName}</h2>
          <div className="mt-1 text-[13px] text-faint">{p.roleLabel}</div>
        </div>

        <Label className="mb-2">{t.settings.profile.firstNameLabel}</Label>
        <Field icon="user" value={firstName} onChange={setFirstName} placeholder={t.settings.profile.firstNamePlaceholder} className="mb-[14px]" />
        <Label className="mb-2">{t.settings.profile.lastNameLabel}</Label>
        <Field icon="user" value={lastName} onChange={setLastName} placeholder={t.settings.profile.lastNamePlaceholder} className="mb-[14px]" />
        <Label className="mb-2">{t.settings.profile.phoneLabel}</Label>
        <div className="mb-1.5 flex items-center gap-[11px] rounded-[14px] border border-line bg-elev px-[11px] py-[13px] transition-colors focus-within:border-acc">
          <CountrySelect value={phoneCountry} onChange={(c) => { setPhoneCountry(c); setPhone(undefined); }} />
          <span className="h-5 w-px shrink-0 bg-line" />
          <PhoneInput country={phoneCountry} value={phone} onChange={setPhone} placeholder={t.settings.profile.phonePlaceholder} className="min-w-0 flex-1 border-none bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint" />
        </div>
        <FormError error={updateProfile.isError ? updateProfile.error : null} />
        {updateProfile.isSuccess && !nameChanged && (
          <p className="mt-2 text-[12.5px] text-acc-soft">{t.settings.profile.profileSaved}</p>
        )}

        <Label className="mb-2 mt-[18px]">{t.settings.profile.emailLabel}</Label>
        <Field icon="mail" value={email} onChange={setEmail} inputMode="email" className="mb-1.5" />
        <div className="pl-0.5 text-[12px] leading-[1.4] text-faint">
          {t.settings.profile.emailNote}
        </div>
        {emailChanged && (
          <Btn kind="dark" full icon="mail" className="mt-3" disabled={updateEmail.isPending} onClick={() => updateEmail.mutate(email.trim())}>
            {updateEmail.isPending ? t.settings.profile.sending : t.settings.profile.changeEmail}
          </Btn>
        )}
        <FormError error={updateEmail.isError ? updateEmail.error : null} />
        {updateEmail.isSuccess && (
          <p className="mt-2 text-[12.5px] text-acc-soft">{t.settings.profile.emailSent}</p>
        )}

        <Label className="mb-[10px] mt-[18px]">{t.settings.profile.securityLabel}</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-4 py-1">
          <MfaCard recommended={p.mfaRequired} />
          <div className="flex items-center gap-[12px] py-[14px]">
            <span className="text-faint">
              <Icon name="mail" size={19} />
            </span>
            <div className="flex-1">
              <div className="text-[14.5px] font-semibold text-text">{t.settings.profile.loginMethodTitle}</div>
              <div className="mt-0.5 text-[12px] text-faint">{t.settings.profile.loginMethodSub}</div>
            </div>
          </div>
        </div>

        <Label className="mb-[10px]">{t.settings.profile.sessionsLabel}</Label>
        {sessionsQ.isLoading ? (
          <Loading />
        ) : sessions.length === 0 ? (
          <Empty text={t.settings.profile.sessionsEmpty} />
        ) : (
          <div className="mb-3 rounded-[18px] border border-line bg-elev px-4 py-0.5">
            {current && (
              <div className={cn('flex items-center gap-[12px] py-[13px]', otherGroups.length > 0 && 'border-b border-line2')}>
                <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[11px] border border-line bg-elev2 text-acc">
                  <Icon name={sessionIcon(current.device)} size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-text">
                    <span className="truncate">{current.device}</span>
                    <span className="shrink-0 rounded-full bg-acc px-[9px] py-[3px] font-display text-[10.5px] font-bold text-on-acc">
                      {t.settings.profile.thisDevice}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-acc">
                    {current.where} · {current.last}
                  </div>
                </div>
              </div>
            )}
            {otherGroups.map((g, i) => (
              <div key={g.ids[0]} className={cn('flex items-center gap-[12px] py-[13px]', i < otherGroups.length - 1 && 'border-b border-line2')}>
                <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[11px] border border-line bg-elev2 text-faint">
                  <Icon name={sessionIcon(g.device)} size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-text">
                    {g.device}
                    {g.count > 1 && <span className="text-faint"> · {fmt(t.settings.profile.sessionCount, { n: g.count })}</span>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-faint">
                    {g.where} · {g.last}
                  </div>
                </div>
                <MiniChip onClick={() => g.ids.forEach((id) => revokeSession.mutate(id))}>
                  {revokeSession.isPending && g.ids.includes(revokeSession.variables as string) ? '…' : t.settings.profile.logOut}
                </MiniChip>
              </div>
            ))}
          </div>
        )}
        <Btn
          kind="dark"
          full
          icon="logout"
          className="mb-2"
          disabled={signingOut !== null}
          onClick={() => {
            setSigningOut('local');
            void signOutDevice(p.userId, 'local');
          }}
        >
          {signingOut === 'local' ? t.settings.profile.signingOut : t.settings.profile.signOut}
        </Btn>
        {others.length > 0 && (
          <Btn
            kind="ghost"
            full
            icon="logout"
            className="mb-[18px]"
            disabled={revokeSession.isPending || signingOut !== null}
            onClick={() => setConfirmLogoutAll(true)}
          >
            {t.settings.profile.logOutAll}
          </Btn>
        )}
        <FormError error={revokeSession.isError ? revokeSession.error : null} />
      </Scroll>
      <BottomBar>
        <Btn
          kind="primary"
          full
          icon="check"
          disabled={!nameChanged || !profileValid || updateProfile.isPending}
          className={!nameChanged || !profileValid ? 'opacity-[0.45]' : ''}
          onClick={() => updateProfile.mutate({ firstName: firstName.trim(), lastName: lastName.trim(), phone: phone ?? '' })}
        >
          {updateProfile.isPending ? t.settings.profile.saving : t.settings.profile.save}
        </Btn>
      </BottomBar>
      {confirmLogoutAll && (
        <Sheet onClose={() => setConfirmLogoutAll(false)} center={false}>
          <Note icon="warn">{t.settings.profile.logoutAllConfirm}</Note>
          <Btn
            kind="primary"
            full
            icon="logout"
            className="mt-2"
            disabled={signingOut !== null}
            onClick={() => {
              setSigningOut('global');
              void signOutDevice(p.userId, 'global');
            }}
          >
            {signingOut === 'global' ? t.settings.profile.loggingOut : t.settings.profile.logoutAllConfirmBtn}
          </Btn>
          <Btn kind="ghost" full className="mt-2" onClick={() => setConfirmLogoutAll(false)}>
            {t.settings.common.cancel}
          </Btn>
        </Sheet>
      )}
    </div>
  );
}

// ── ABONNEMENT & FACTUREN (pushed) — live, with checkout/portal (fase 13 PR 2) ─
// Any member views the entitlement (RLS subscriptions_select_member); an ADMIN
// in the BROWSER additionally gets the Stripe-hosted checkout and portal
// redirects. The native shell stays read-only without even a link — store-tax
// seam (#32/#37, isNativeShell).
const SUB_STATUS: Record<PoSubscription['status'], { label: string; chip: string }> = {
  trialing: { label: t.settings.billing.statusTrialing, chip: 'bg-acc-dim text-acc' },
  active: { label: t.settings.billing.statusActive, chip: 'bg-acc-dim text-acc' },
  comped: { label: t.settings.billing.statusComped, chip: 'bg-acc-dim text-acc' },
  past_due: { label: t.settings.billing.statusPastDue, chip: 'bg-red-300/15 text-red-300' },
  canceled: { label: t.settings.billing.statusCanceled, chip: 'bg-elev2 text-faint' },
};

export function Billing(): JSX.Element {
  const nav = useNav();
  const subQ = usePoSubscription();
  const sub = subQ.data ?? null;
  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.settings.billing.title} />
      <Scroll bottom={28}>
        {subQ.isLoading ? (
          <Empty text={t.settings.billing.loading} />
        ) : subQ.isError ? (
          <Empty text={t.settings.billing.loadError} />
        ) : !sub ? (
          <Empty text={t.settings.billing.empty} />
        ) : (
          <BillingBody sub={sub} />
        )}
      </Scroll>
    </div>
  );
}

/** Whole days until the trial ends; negative = already lapsed. */
function trialDaysLeft(trialEndsAt: string): number {
  return Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function BillingBody({ sub }: { sub: PoSubscription }): JSX.Element {
  const st = SUB_STATUS[sub.status] ?? { label: sub.status.toUpperCase(), chip: 'bg-elev2 text-faint' };
  const { roles } = usePoIdentity();
  const isAdmin = roles.includes('admin');
  const native = isNativeShell();
  const checkout = usePoBillingCheckout();
  const portal = usePoBillingPortal();

  // Checkout applies while no Stripe subscription exists (fresh trial, lapsed
  // trial, canceled). comped is pilot territory — no self-service billing.
  const needsCheckout = !sub.stripeLinked && sub.status !== 'comped';
  const daysLeft = sub.trialEndsAt ? trialDaysLeft(sub.trialEndsAt) : null;

  const go = (m: { mutateAsync: () => Promise<string> }) => (): void => {
    void m.mutateAsync().then((url) => window.location.assign(url));
  };
  const busy = checkout.isPending || portal.isPending;

  return (
    <>
      <div className="mb-[14px] rounded-[18px] bg-acc-dim p-5">
        <div className="mb-[14px] flex items-center justify-between">
          <div className="flex items-center gap-[10px]">
            <Icon name="spark" size={20} stroke="#B5A6FF" />
            <span className="font-display text-[20px] font-extrabold text-text">{sub.plan}</span>
          </div>
          <MiniChip className={cn('border-transparent', st.chip)}>{st.label}</MiniChip>
        </div>
        <div className="mb-4 flex items-end gap-1.5">
          <span className="font-display text-[36px] font-extrabold leading-none text-text">{sub.priceLabel}</span>
          {sub.priceLabel.startsWith('€') && <span className="pb-[5px] text-[14px] text-dim">/ {sub.period}</span>}
        </div>
        <div className="grid grid-cols-2 gap-[10px]">
          {([[t.settings.billing.fieldEvents, sub.events], [t.settings.billing.fieldVenue, sub.venueLabel], [t.settings.billing.fieldRenews, sub.renews], [t.settings.billing.fieldStatus, st.label]] as const).map(([k, val]) => (
            <div key={k}>
              <div className="text-[11.5px] text-dim">{k}</div>
              <div className="mt-0.5 font-display text-[14px] font-bold text-text">{val}</div>
            </div>
          ))}
        </div>
      </div>

      {sub.status === 'past_due' && (
        <Note icon="warn">{t.settings.billing.pastDueBanner}</Note>
      )}
      {needsCheckout && sub.status === 'trialing' && daysLeft != null && (
        <Note icon={daysLeft >= 0 ? 'clock' : 'warn'}>
          {daysLeft >= 0
            ? fmt(t.settings.billing.trialEndsIn, { days: String(Math.max(daysLeft, 0)) })
            : t.settings.billing.trialEnded}
        </Note>
      )}

      {isAdmin && !native && (
        <div className="mb-[18px] mt-1 flex flex-col gap-2.5">
          {needsCheckout && (
            <Btn kind="primary" full icon="card" disabled={busy} onClick={go(checkout)}>
              {checkout.isPending
                ? t.settings.billing.redirecting
                : sub.status === 'canceled'
                  ? t.settings.billing.reactivate
                  : t.settings.billing.setupPayment}
            </Btn>
          )}
          {sub.stripeLinked && (
            <Btn kind="dark" full icon="note" disabled={busy} onClick={go(portal)}>
              {portal.isPending ? t.settings.billing.redirecting : t.settings.billing.managePortal}
            </Btn>
          )}
          <FormError error={checkout.error ?? portal.error} />
        </div>
      )}
      {native && (
        <div className="mb-[18px] mt-1 flex items-start gap-[7px] pl-0.5 text-[12px] text-faint">
          <Icon name="shield" size={13} className="text-ghost" />
          <span className="leading-[1.45]">{t.settings.billing.manageOnWeb}</span>
        </div>
      )}

      <Label className="mb-[10px]">{t.settings.billing.paymentMethodLabel}</Label>
      <div className="mb-2 flex items-center gap-[13px] rounded-[18px] border border-line bg-elev p-4">
        <span className="flex h-[42px] w-[42px] items-center justify-center rounded-[12px] border border-line bg-elev2 text-acc">
          <Icon name="card" size={20} />
        </span>
        <div className="flex-1">
          <div className="text-[14.5px] font-semibold text-text">{t.settings.billing.paymentMethodTitle}</div>
          <div className="mt-0.5 text-[12.5px] text-faint">{t.settings.billing.paymentMethodSub}</div>
        </div>
      </div>
      <div className="mb-[18px] flex items-start gap-[7px] pl-0.5 text-[12px] text-faint">
        <Icon name="shield" size={13} className="text-ghost" />
        <span className="leading-[1.45]">{t.settings.billing.paymentNote}</span>
      </div>

      <Label className="mb-[10px]">{t.settings.billing.invoicesLabel}</Label>
      <div className="rounded-[18px] border border-dashed border-line bg-elev p-5 text-center">
        <div className="text-[13.5px] leading-[1.5] text-faint">
          {sub.stripeLinked && !native
            ? t.settings.billing.invoicesPortal
            : t.settings.billing.invoicesSoon}
        </div>
      </div>
    </>
  );
}

// ── IMPORTEREN (pushed) — S3 Import, live ────────────────────────────────────
// Paste a list or a CSV → parse + coerce (phone to E.164, plausible birthdate) →
// dedupe within the file → preview each row as NIEUW or BESTAAT AL against the
// venue's existing contacts (same email-first-else-phone match as upsert_contacts)
// → commit via the idempotent RPC. Manager-only (the action self-guards). Phone
// contacts / "vorig event" sources come later.
type ImportSource = 'paste' | 'csv';

export function Import(): JSX.Element {
  const nav = useNav();
  const { venueId } = usePoIdentity();
  const importMut = usePoImportContacts();
  const keysQ = usePoContactKeys();

  const [source, setSource] = useState<ImportSource>('paste');
  const [text, setText] = useState('');
  // CSV header handling (Q12): auto-detect a recognised header, but let the user
  // override per file (null = follow auto-detect). Only relevant for CSV.
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null);
  const autoHeader = source === 'csv' && csvFirstRowIsHeader(text);
  const firstRowIsHeader = headerOverride ?? autoHeader;

  // Parse → coerce to what the import accepts (so the preview's dedup decision
  // matches the real import) → dedupe within the file.
  const { rows, intraSkipped } = useMemo(() => {
    const parsed = source === 'csv' ? parseCsv(text, { firstRowIsHeader }) : parsePastedList(text);
    const coerced = parsed.map((r) => ({
      ...r,
      phone: normalizeImportPhone(r.phone),
      birthdate: normalizeImportBirthdate(r.birthdate),
    }));
    const { rows: deduped, skipped } = dedupeWithin(coerced);
    return { rows: deduped, intraSkipped: skipped };
  }, [text, source, firstRowIsHeader]);

  // Classify against existing contacts exactly like the RPC: e-mail first, else
  // phone digits. While the keys load, nothing is marked as a duplicate yet.
  const emails = keysQ.data?.emails;
  const phones = keysQ.data?.phones;
  const classified = rows.map((r) => {
    const e = normalizeEmail(r.email);
    const p = normalizePhoneToDigits(r.phone);
    const exists = (!!e && !!emails?.has(e)) || (!!p && !!phones?.has(p));
    return { row: r, exists };
  });
  const total = classified.length;
  const dupCount = classified.filter((c) => c.exists).length;
  const newCount = total - dupCount;

  const result = importMut.data && importMut.data.ok ? importMut.data : null;
  const canImport = !!venueId && total > 0 && !importMut.isPending;

  const onPickFile = (file: File | undefined): void => {
    if (!file) return;
    setSource('csv');
    setHeaderOverride(null); // re-auto-detect for the new file
    void file.text().then(setText);
  };

  const commit = (): void => {
    if (!canImport || !venueId) return;
    importMut.mutate({ venueId, rows });
  };

  // Success state — the per-row outcome from the RPC.
  if (result) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.import.title} />
        <Scroll bottom={100}>
          <div className="mb-4 flex flex-col items-center gap-3 rounded-[18px] bg-acc-dim p-6 text-center">
            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[16px] bg-acc">
              <Icon name="check2" size={28} stroke="#16132B" sw={2.4} />
            </span>
            <div className="font-display text-[22px] font-extrabold text-text">{t.settings.import.doneTitle}</div>
            <div className="text-[13.5px] leading-[1.5] text-text">
              {fmt(t.settings.import.doneSummary, { inserted: result.inserted, updated: result.updated, skipped: result.skipped })}
            </div>
          </div>
          <Note icon="contact">
            {t.settings.import.doneNote}
          </Note>
        </Scroll>
        <BottomBar>
          <Btn
            kind="primary"
            full
            icon="contact"
            onClick={() => {
              importMut.reset();
              nav.back();
            }}
          >
            {t.settings.import.toContacts}
          </Btn>
        </BottomBar>
      </div>
    );
  }

  const sources: [ImportSource | 'soon', IconName, string][] = [
    ['paste', 'paste', t.settings.import.sourcePaste],
    ['csv', 'upload', t.settings.import.sourceCsv],
    ['soon', 'contact', t.settings.import.sourcePhone],
    ['soon', 'ticket', t.settings.import.sourceLastEvent],
  ];

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.settings.import.title} />
      <Scroll bottom={total > 0 ? 110 : 40}>
        <div className="mb-[14px] text-[13.5px] leading-[1.5] text-faint">
          {t.settings.import.intro}
        </div>
        <div className="po-scroll mb-4 flex gap-2 overflow-x-auto">
          {sources.map(([key, ic, l]) => {
            const on = key === source;
            const soon = key === 'soon';
            return (
              <button
                key={l}
                type="button"
                disabled={soon}
                onClick={() => {
                  if (soon) return;
                  setSource(key as ImportSource);
                  setHeaderOverride(null);
                }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-[7px] rounded-full border px-[14px] py-[9px] font-display text-[13px] font-bold',
                  press,
                  on ? 'border-transparent bg-acc text-on-acc' : 'border-line text-dim',
                  soon && 'opacity-40',
                )}
              >
                <Icon name={ic} size={15} sw={2.1} />
                {l}
                {soon && <span className="text-[10px] font-bold text-faint">{t.settings.import.sourceSoon}</span>}
              </button>
            );
          })}
        </div>

        {source === 'csv' && (
          <>
            <label className={cn('mb-3 flex cursor-pointer items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-elev py-[14px] font-display text-[14px] font-bold text-text', press)}>
              <Icon name="upload" size={17} />
              {t.settings.import.pickCsv}
              <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => onPickFile(e.target.files?.[0])} />
            </label>
            {text.trim() !== '' && (
              <button
                type="button"
                onClick={() => setHeaderOverride(!firstRowIsHeader)}
                className={cn('mb-3 flex w-full items-center gap-[11px] rounded-[13px] border border-line bg-elev px-[13px] py-[11px] text-left', press)}
              >
                <span className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border-2', firstRowIsHeader ? 'border-acc bg-acc' : 'border-ghost bg-transparent')}>
                  {firstRowIsHeader && <Icon name="check" size={13} stroke="#16132B" sw={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[13.5px] font-bold text-text">{t.settings.import.headerTitle}</span>
                  <span className="block text-[11.5px] text-faint">{t.settings.import.headerSub}</span>
                </span>
              </button>
            )}
          </>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={
            source === 'csv'
              ? t.settings.import.csvPlaceholder
              : t.settings.import.pastePlaceholder
          }
          className="mb-4 w-full resize-y rounded-[14px] border border-line bg-elev p-[14px] font-body text-[14.5px] leading-[1.5] text-text outline-none placeholder:text-faint"
        />

        {total > 0 && (
          <>
            <div className="mb-[10px] flex items-center justify-between">
              <Label>
                {fmt(total === 1 ? t.settings.import.recognizedOne : t.settings.import.recognizedMany, { n: total })}
              </Label>
              <div className="flex gap-1.5">
                <MiniChip className="border-transparent bg-acc-dim text-acc">{fmt(t.settings.import.newCount, { n: newCount })}</MiniChip>
                {dupCount > 0 && <MiniChip>{fmt(t.settings.import.existsCount, { n: dupCount })}</MiniChip>}
              </div>
            </div>
            {keysQ.isLoading && <div className="mb-2 text-[12px] text-faint">{t.settings.import.checkingDuplicates}</div>}
            <div className="flex flex-col gap-2">
              {classified.slice(0, 50).map(({ row, exists }, i) => (
                <div key={`${row.fullName}-${i}`} className="flex items-center gap-[11px] rounded-[13px] border border-line bg-elev px-[12px] py-[10px]">
                  <Avatar name={row.fullName} size={34} accent={exists} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-text">{row.fullName}</div>
                    {(row.email || row.phone) && <div className="truncate text-[11.5px] text-faint">{row.email ?? row.phone}</div>}
                  </div>
                  <span className={cn('shrink-0 rounded-[7px] px-2 py-[3px] text-[10.5px] font-bold', exists ? 'bg-acc-dim text-acc' : 'border border-line text-text')}>
                    {exists ? t.settings.import.rowExists : t.settings.import.rowNew}
                  </span>
                </div>
              ))}
            </div>
            {total > 50 && <div className="mt-2 text-center text-[12px] text-faint">{fmt(t.settings.import.moreImported, { n: total - 50 })}</div>}
            {intraSkipped > 0 && <div className="mt-2 text-[12px] text-faint">{fmt(t.settings.import.intraSkipped, { n: intraSkipped })}</div>}
          </>
        )}

        {importMut.isError && (
          <div className="mt-3 flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
            <Icon name="warn" size={16} stroke="#B5A6FF" />
            <span className="flex-1">{importMut.error?.message ?? t.settings.import.importError}</span>
          </div>
        )}
      </Scroll>
      {total > 0 && (
        <BottomBar>
          <Btn kind="primary" full icon="check" disabled={!canImport} className={canImport ? '' : 'opacity-[0.45]'} onClick={commit}>
            {importMut.isPending ? t.settings.import.importing : fmt(total === 1 ? t.settings.import.importOne : t.settings.import.importMany, { n: total })}
          </Btn>
        </BottomBar>
      )}
    </div>
  );
}
