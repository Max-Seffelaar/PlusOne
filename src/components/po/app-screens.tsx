'use client';

/**
 * The non-door half of the po shell: the URL→screen switch and the lazy screen
 * chunks it reaches.
 *
 * Extracted from `app.tsx` (86eykm76k) for one structural reason beyond file
 * size: it must sit BESIDE the door branch rather than above it. It used to read
 * `usePoEvents()` here; when the venue's event list refetched, only this subtree
 * re-rendered — the door subtree is a sibling `children` element the shell root
 * never rebuilt. Keeping `usePoEvents` in the shell root is what used to force
 * the door's twelve hand-maintained memos.
 *
 * Since Snelheid P1 (perf audit 2026-10 finding 4) the switch reads no query at
 * all: the venue's full event history (events + every guest/check-in headcount
 * it ever had) was loaded on every non-door screen just so `lijst` could wait
 * for its event row. The guest list mounts straight from the URL's event id
 * now; screens that need the event list read it themselves.
 *
 * It is only ever mounted when the active target is NOT a door URL, so nothing
 * here runs at all while the doorhost is on the Deur tab.
 */
import { type JSX, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Top } from './kit';
import type { Nav, ScreenName, ScreenProps } from './context';
import type { ParsedTarget } from './routes';
import { t } from '@/lib/i18n';
import { Crew, EventEdit, EventView, Events, PastEvent, Tiers } from './screens/events';
import { BulkPaste, Contacten, ContactProfile, GuestsTab } from './screens/guests';
import { Allowance, Billing, Gebruikers, Import, Meer, Profile, Rollen, VenueSettings, VenueSwitch } from './screens/settings';
import { VenueCreate } from './screens/onboarding';
import { Home } from './screens/home';

/**
 * Code-split (#2a): the heavy/rare screens below each live in their own module
 * that is only ever reached here, deep in the nav stack — so they have no place
 * on the door-only / common path. Loading them lazily via `next/dynamic` keeps
 * the `/app` First Load JS lean: a doorhost (Check-in/Taken only) never pulls the
 * Statistieken / Audit / Admin-sessies / Aanvragen chunks. Each module is
 * self-contained (it exports nothing the common path imports), so the chunk is
 * cleanly evicted from the shared bundle. `ssr: false` is safe — these only
 * mount after client-side navigation inside the already-client app shell.
 *
 * NOTE: Billing/Import are intentionally NOT split — they share `settings.tsx`
 * with `Meer` (an always-present hub), so the module stays in the common chunk
 * regardless; a dynamic import there would add a Suspense boundary for no size win.
 */
const ScreenLoading = (): JSX.Element => (
  <div className="flex h-full flex-1 items-center justify-center text-[14px] text-faint">{t.common.loading}</div>
);
const Stats = dynamic(() => import('./screens/stats').then((m) => m.Stats), {
  loading: ScreenLoading,
  ssr: false,
});
const AuditLog = dynamic(() => import('./screens/audit').then((m) => m.AuditLog), {
  loading: ScreenLoading,
  ssr: false,
});
const AdminSessions = dynamic(() => import('./screens/admin-sessions').then((m) => m.AdminSessions), {
  loading: ScreenLoading,
  ssr: false,
});
const Aanvragen = dynamic(() => import('./screens/approvals').then((m) => m.Aanvragen), {
  loading: ScreenLoading,
  ssr: false,
});
const Templates = dynamic(() => import('./screens/templates').then((m) => m.Templates), {
  loading: ScreenLoading,
  ssr: false,
});
const TemplateEdit = dynamic(() => import('./screens/templates').then((m) => m.TemplateEdit), {
  loading: ScreenLoading,
  ssr: false,
});
const EventLinks = dynamic(() => import('./screens/promotion/event-links').then((m) => m.EventLinks), {
  loading: ScreenLoading,
  ssr: false,
});
const PromotionHub = dynamic(() => import('./screens/promotion').then((m) => m.PromotionHub), {
  loading: ScreenLoading,
  ssr: false,
});
// Platform (P-04): PlusOne's own operator surface. Split for the same reason as
// Stats/Audit — every venue user pays for whatever sits in the common chunk,
// and this screen is reachable for a handful of people in the whole product.
const Platform = dynamic(() => import('./screens/platform').then((m) => m.Platform), {
  loading: ScreenLoading,
  ssr: false,
});
// Platform > Venues / Audit (P-05): same reasoning as Platform itself — split
// out of the common chunk, reachable only for a platform admin.
const PlatformVenues = dynamic(
  () => import('./screens/platform-venues').then((m) => m.PlatformVenues),
  { loading: ScreenLoading, ssr: false },
);
const PlatformAudit = dynamic(
  () => import('./screens/platform-audit').then((m) => m.PlatformAudit),
  { loading: ScreenLoading, ssr: false },
);
const PlatformOverview = dynamic(
  () => import('./screens/platform-overview').then((m) => m.PlatformOverview),
  { loading: ScreenLoading, ssr: false },
);
const PlatformAccessLog = dynamic(
  () => import('./screens/platform-access-log').then((m) => m.PlatformAccessLog),
  { loading: ScreenLoading, ssr: false },
);
// QuickAdd (#2b): the guest quick-add flow carries the parser + dedupe engine and
// (via the lazy phone field) the country picker — heavy and only ever reached by
// tapping "add guest", never on the door-only / common path. Split into its own
// chunk. Imported from the leaf module (not the guests barrel) so the common
// GuestsTab chunk doesn't drag it back in.
const QuickAdd = dynamic(() => import('./screens/guests/quick-add').then((m) => m.QuickAdd), {
  loading: ScreenLoading,
  ssr: false,
});

/** Shown while a pushed event/guest screen waits for its live row to load. */
function Loading({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <Top onBack={onBack} title={t.common.loading} />
      <div className="flex flex-1 items-center justify-center text-[14px] text-faint">{t.common.loading}</div>
    </div>
  );
}

function screenFor(name: ScreenName, p: ScreenProps, nav: Nav): ReactNode {
  switch (name) {
    case 'event':
      return <EventView id={p.id} />;
    case 'lijst':
      // Pinned straight from the URL (no wait on the venue's event list): the
      // guest list reads its own event's guests/tiers by id.
      return p.id ? <GuestsTab pinnedEventId={p.id} /> : <Loading onBack={nav.back} />;
    case 'guest':
      // Tapping a guest opens the unified person profile (linked → cross-event,
      // name-only → this one event), with the originating event pinned on top.
      return <ContactProfile guestId={p.id} originEventId={p.eventId} />;
    case 'contacten':
      return <Contacten eventId={p.id} />;
    case 'contactprofile':
      return <ContactProfile contactId={p.id} />;
    case 'rollen':
      return <Rollen />;
    case 'import':
      return <Import />;
    case 'quickadd':
      return <QuickAdd eventId={p.id} />;
    case 'bulk':
      return <BulkPaste eventId={p.id} />;
    case 'aanvragen':
      // ScreenProps.tab is shared with the Promotion hub — narrow to aanvragen's own queues.
      return <Aanvragen eventId={p.id} initialTab={p.tab === 'landing' || p.tab === 'quota' ? p.tab : undefined} />;
    case 'eventedit':
      return <EventEdit id={p.id} isNew={p.isNew} />;
    case 'tiers':
      return <Tiers eventId={p.id} setup={p.setup} />;
    case 'crew':
      return <Crew eventId={p.id} />;
    case 'gebruikers':
      return <Gebruikers />;
    case 'pastevent':
      return <PastEvent id={p.id} />;
    case 'venueswitch':
      return <VenueSwitch />;
    case 'venuesettings':
      return <VenueSettings />;
    case 'venuecreate':
      return <VenueCreate />;
    case 'profile':
      return <Profile />;
    case 'billing':
      return <Billing />;
    case 'allowance':
      return <Allowance />;
    case 'stats':
      return <Stats />;
    case 'audit':
      return <AuditLog eventId={p.id} />;
    case 'adminsessions':
      return <AdminSessions />;
    case 'templates':
      return <Templates />;
    case 'templateedit':
      return <TemplateEdit id={p.id} isNew={p.isNew} />;
    case 'links':
      return <EventLinks eventId={p.id} />;
    case 'promotion':
      return <PromotionHub tab={p.tab} eventId={p.id} />;
    case 'platform':
      return <Platform />;
    case 'platformvenues':
      return <PlatformVenues />;
    case 'platformaudit':
      return <PlatformAudit venueId={p.id} />;
    case 'platformaccess':
      return <PlatformAccessLog venueId={p.id} />;
    case 'platformoverview':
      return <PlatformOverview />;
    default:
      return null;
  }
}

export function AppScreens({ target, nav }: { target: ParsedTarget; nav: Nav }): JSX.Element {
  let screen: ReactNode;
  if (target.kind === 'screen') {
    screen = screenFor(target.name, target.props, nav);
  } else if (target.kind === 'tab') {
    switch (target.tab) {
      case 'start':
        screen = <Home />;
        break;
      case 'events':
        screen = <Events />;
        break;
      case 'guests':
        screen = <GuestsTab />;
        break;
      case 'meer':
        screen = <Meer />;
        break;
    }
  } else {
    // A 'door' URL for a non-door role (unreachable via the nav UI — the tab is
    // hidden — but a stray/typed URL should degrade gracefully, not blank).
    screen = <Home />;
  }
  return <>{screen}</>;
}
