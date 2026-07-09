'use client';

/** Settings cluster: Meer (hub), gebruikers/rollen, toelage, venue switch/beheer,
 *  persoonlijke gegevens + sessies, abonnement & facturen, importeren.
 *  FE-5: split into settings/team|quota|profile|venue|billing|import.tsx; this
 *  file stays the thin hub (Meer) + re-exports so external imports of
 *  `./screens/settings` keep working unchanged. */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { canWorkDoor } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { usePoProfile, usePoSubscription, usePoCanManageTemplates, usePoGuestRequests } from '@/features/po/hooks';
import { isOpenGuestRequest } from '@/features/po/adapters';
import { useNav, usePo } from '../context';
import { Icon } from '../icon';
import { Avatar, Label, Row, Scroll, Top, cardPress } from '../kit';
import { armRegularsFilter } from './guests';
import { col, signOutDevice } from './settings/_shared';

export { Gebruikers } from './settings/team';
export { Rollen, Allowance } from './settings/quota';
export { VenueSwitch, VenueSettings } from './settings/venue';
export { Profile } from './settings/profile';
export { Billing } from './settings/billing';
export { Import } from './settings/import';

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
            <div className="text-[12.5px] text-faint">{fmt(t.settings.more.switchSub, { name: profile.data?.name ?? t.settings.more.nameFallback })}</div>
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
          <Row icon="star" title={t.settings.more.regularsTitle} sub={t.settings.more.regularsSub} onClick={() => { armRegularsFilter(); nav.setTab('guests'); }} accent />
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
