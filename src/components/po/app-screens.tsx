'use client';

/**
 * The non-door half of the po shell: the URL→screen switch and the lazy screen
 * chunks it reaches.
 *
 * Extracted from `app.tsx` (86eykm76k) for one structural reason beyond file
 * size: this component reads `usePoEvents()`, and it must sit BESIDE the door
 * branch rather than above it. When the venue's event list refetches, only this
 * subtree re-renders — the door subtree is a sibling `children` element the
 * shell root never rebuilt, so React has nothing to reconcile there. Keeping
 * `usePoEvents` in the shell root is what used to force the door's twelve
 * hand-maintained memos.
 *
 * It is only ever mounted when the active target is NOT a door URL, so nothing
 * here runs at all while the doorhost is on the Deur tab.
 */
import { type JSX, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { usePoEvents } from '@/features/po/hooks';
import type { PoEvent } from '@/lib/po/types';
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

function screenFor(name: ScreenName, p: ScreenProps, nav: Nav, ev: (id?: string) => PoEvent | undefined): ReactNode {
  switch (name) {
    case 'event':
      return <EventView id={p.id} />;
    case 'lijst': {
      const e = ev(p.id);
      return e ? <GuestsTab pinnedEventId={e.id} /> : <Loading onBack={nav.back} />;
    }
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
    default:
      return null;
  }
}

export function AppScreens({ target, nav }: { target: ParsedTarget; nav: Nav }): JSX.Element {
  // The one live read this half of the shell needs: `lijst` waits for its event
  // row to resolve before mounting the guest list. Deliberately read HERE and
  // not in the shell root — see the module comment.
  const { data: events } = usePoEvents();
  const ev = (id?: string): PoEvent | undefined => events.find((e) => e.id === id);

  let screen: ReactNode;
  if (target.kind === 'screen') {
    screen = screenFor(target.name, target.props, nav, ev);
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
