/**
 * Canonical URL scheme for the po `/app` surface (G1). Every screen gets a real,
 * bookmarkable path instead of living behind an in-memory nav stack on one URL.
 *
 * `screenPath`/`tabPath`/`doorPath` build a URL for a `nav.push/replace` call;
 * `parseAppUrl` is the inverse, used by `app.tsx` to derive "what screen is this"
 * from the live pathname + search params on every render. Keep both directions
 * symmetric: a field is only ever given an explicit default when the URL itself
 * encodes it (a segment like `/edit` or `/quota`) — everywhere else an absent
 * value stays `undefined`/`null`, so `screenPath(parseAppUrl(url)) === url` and
 * round-trip tests (`routes.test.ts`) can assert with plain `toEqual`.
 */
import type { TabKey } from './shell';
import type { ScreenName, ScreenProps } from './context';

export type DoorSeg = 'deur' | 'taken';
export type DoorOverlayState = { kind: 'guest'; id: string } | { kind: 'add' } | null;

export interface DoorTarget {
  kind: 'door';
  seg: DoorSeg;
  eventId: string | null;
  overlay: DoorOverlayState;
}

export interface TabTarget {
  kind: 'tab';
  tab: Exclude<TabKey, 'deur'>;
}

export interface ScreenTarget {
  kind: 'screen';
  name: ScreenName;
  props: ScreenProps;
}

export type ParsedTarget = TabTarget | DoorTarget | ScreenTarget;

/** Append `?event=<id>` (properly encoded, matching `doorPath`'s URLSearchParams
 *  use below) when an event scope is given; otherwise the bare path. */
function withEventQuery(base: string, eventId: string | undefined): string {
  if (!eventId) return base;
  return `${base}?${new URLSearchParams({ event: eventId }).toString()}`;
}

/** Build the URL (path + optional query) for a pushed/replaced screen. */
export function screenPath(name: ScreenName, props: ScreenProps = {}): string {
  const { id, eventId, isNew, tab } = props;
  switch (name) {
    case 'event':
      return `/app/events/${id}`;
    case 'eventedit':
      return isNew ? '/app/events/new' : `/app/events/${id}/edit`;
    case 'lijst':
      return `/app/events/${id}/guests`;
    case 'tiers':
      return `/app/events/${id}/tiers`;
    case 'crew':
      return `/app/events/${id}/crew`;
    case 'links':
      return `/app/events/${id}/links`;
    // Both self-pick an event (curEv/upcoming[0]) when no id is given — the one
    // real caller of each (Events tab CTA / BulkPaste's empty-event fallback)
    // relies on that, so an absent id must NOT fall through to the nested
    // event route (that produced a literal `/app/events/undefined/add`).
    case 'quickadd':
      return id ? `/app/events/${id}/add` : '/app/add';
    case 'bulk':
      return id ? `/app/events/${id}/bulk` : '/app/bulk';
    case 'pastevent':
      return `/app/events/${id}/recap`;
    case 'guest':
      return withEventQuery(`/app/guests/${id}`, eventId);
    case 'contacten':
      return withEventQuery('/app/contacts', id);
    case 'contactprofile':
      return `/app/contacts/${id}`;
    case 'import':
      return '/app/contacts/import';
    case 'rollen':
      return '/app/roles';
    case 'aanvragen':
      return withEventQuery(tab === 'quota' ? '/app/requests/quota' : '/app/requests', id);
    case 'gebruikers':
      return '/app/team';
    // Venue-scoped with an internal event picker (quota.tsx), not truly
    // event-scoped — the only caller (More hub) never has an event in scope,
    // so this is a top-level route, not nested under /app/events/:id.
    case 'allowance':
      return '/app/allowance';
    case 'venueswitch':
      return '/app/venue/switch';
    case 'venuesettings':
      return '/app/venue';
    case 'venuecreate':
      return '/app/venue/new';
    case 'profile':
      return '/app/profile';
    case 'billing':
      return '/app/billing';
    case 'stats':
      return '/app/analytics';
    case 'audit':
      return withEventQuery('/app/audit', id);
    case 'adminsessions':
      return '/app/sessions';
    case 'templates':
      return '/app/templates';
    case 'templateedit':
      return isNew ? '/app/templates/new' : `/app/templates/${id}`;
    case 'influencers':
      return '/app/influencers';
    case 'promo':
      return '/app/promo';
  }
}

/** Build the URL for a tab root (Start/Events/Guests/More — Deur uses `doorPath`). */
export function tabPath(tab: Exclude<TabKey, 'deur'>): string {
  switch (tab) {
    case 'start':
      return '/app';
    case 'events':
      return '/app/events';
    case 'guests':
      return '/app/guests';
    case 'meer':
      return '/app/more';
  }
}

/** Build the URL for the Deur/Taken door tab, its per-event override, and its
 *  in-tab overlay (guest detail / add-on-spot) — all four live in the query
 *  string since they're sub-state of the door tab, not distinct destinations.
 *  `seg` in particular MUST stay a query param, not a path segment
 *  (`/app/door/tasks`): a path change forces an RSC fetch even when nothing
 *  server-side depends on it, which fails offline (hard-navigation fallback,
 *  wrong service-worker shell) — exactly the failure mode the guest/add
 *  overlay was already moved off of. Switching Deur↔Taken mid-shift with no
 *  signal is a real scenario, not hypothetical, so it gets the same treatment. */
export function doorPath(opts: { seg?: DoorSeg; eventId?: string | null; overlay?: DoorOverlayState } = {}): string {
  const { seg = 'deur', eventId = null, overlay = null } = opts;
  const params = new URLSearchParams();
  if (seg === 'taken') params.set('seg', 'taken');
  if (eventId) params.set('event', eventId);
  if (overlay?.kind === 'guest') params.set('guest', overlay.id);
  else if (overlay?.kind === 'add') params.set('add', '1');
  const qs = params.toString();
  return qs ? `/app/door?${qs}` : '/app/door';
}

/** Parse the live `/app/...` pathname + search params into the screen/tab/door
 *  target it represents. An unrecognized path falls back to Start rather than
 *  crashing — a stale bookmark or a typo'd URL should degrade gracefully. */
export function parseAppUrl(pathname: string, search: URLSearchParams): ParsedTarget {
  const segments = pathname.replace(/^\/app\/?/, '').split('/').filter(Boolean);
  if (segments.length === 0) return { kind: 'tab', tab: 'start' };
  const [first, second, third] = segments;

  if (first === 'events') {
    if (!second) return { kind: 'tab', tab: 'events' };
    if (second === 'new') return { kind: 'screen', name: 'eventedit', props: { isNew: true } };
    if (!third) return { kind: 'screen', name: 'event', props: { id: second } };
    switch (third) {
      case 'edit':
        return { kind: 'screen', name: 'eventedit', props: { id: second } };
      case 'guests':
        return { kind: 'screen', name: 'lijst', props: { id: second } };
      case 'tiers':
        return { kind: 'screen', name: 'tiers', props: { id: second } };
      case 'crew':
        return { kind: 'screen', name: 'crew', props: { id: second } };
      case 'links':
        return { kind: 'screen', name: 'links', props: { id: second } };
      case 'add':
        return { kind: 'screen', name: 'quickadd', props: { id: second } };
      case 'bulk':
        return { kind: 'screen', name: 'bulk', props: { id: second } };
      case 'recap':
        return { kind: 'screen', name: 'pastevent', props: { id: second } };
      default:
        // Deliberately more specific than the top-level fallback at the bottom
        // of this function: an unrecognized THIRD segment still names a real
        // event id, so degrade to that event's detail screen rather than
        // discarding it for bare Start — we know more here than "unknown path".
        return { kind: 'screen', name: 'event', props: { id: second } };
    }
  }

  if (first === 'guests') {
    if (!second) return { kind: 'tab', tab: 'guests' };
    return { kind: 'screen', name: 'guest', props: { id: second, eventId: search.get('event') ?? undefined } };
  }

  if (first === 'door') {
    const seg: DoorSeg = search.get('seg') === 'taken' ? 'taken' : 'deur';
    const guestId = search.get('guest');
    const overlay: DoorOverlayState = guestId ? { kind: 'guest', id: guestId } : search.get('add') ? { kind: 'add' } : null;
    return { kind: 'door', seg, eventId: search.get('event'), overlay };
  }

  if (first === 'contacts') {
    if (!second) return { kind: 'screen', name: 'contacten', props: { id: search.get('event') ?? undefined } };
    if (second === 'import') return { kind: 'screen', name: 'import', props: {} };
    return { kind: 'screen', name: 'contactprofile', props: { id: second } };
  }

  if (first === 'roles') return { kind: 'screen', name: 'rollen', props: {} };
  // Top-level fallback for quickadd/bulk with no event picked yet (both screens
  // self-pick an event when props.id is absent) — mirrors the events/:id/add
  // and events/:id/bulk forms above, which are used when an event IS in scope.
  if (first === 'add') return { kind: 'screen', name: 'quickadd', props: {} };
  if (first === 'bulk') return { kind: 'screen', name: 'bulk', props: {} };
  // Venue-scoped with an internal event picker — see screenPath's comment.
  if (first === 'allowance') return { kind: 'screen', name: 'allowance', props: {} };

  if (first === 'requests') {
    return {
      kind: 'screen',
      name: 'aanvragen',
      props: { id: search.get('event') ?? undefined, tab: second === 'quota' ? 'quota' : undefined },
    };
  }

  if (first === 'team') return { kind: 'screen', name: 'gebruikers', props: {} };

  if (first === 'venue') {
    if (second === 'switch') return { kind: 'screen', name: 'venueswitch', props: {} };
    if (second === 'new') return { kind: 'screen', name: 'venuecreate', props: {} };
    return { kind: 'screen', name: 'venuesettings', props: {} };
  }

  if (first === 'profile') return { kind: 'screen', name: 'profile', props: {} };
  if (first === 'billing') return { kind: 'screen', name: 'billing', props: {} };
  if (first === 'analytics') return { kind: 'screen', name: 'stats', props: {} };
  if (first === 'audit') return { kind: 'screen', name: 'audit', props: { id: search.get('event') ?? undefined } };
  if (first === 'sessions') return { kind: 'screen', name: 'adminsessions', props: {} };

  if (first === 'templates') {
    if (!second) return { kind: 'screen', name: 'templates', props: {} };
    if (second === 'new') return { kind: 'screen', name: 'templateedit', props: { isNew: true } };
    return { kind: 'screen', name: 'templateedit', props: { id: second } };
  }

  if (first === 'influencers') return { kind: 'screen', name: 'influencers', props: {} };
  if (first === 'promo') return { kind: 'screen', name: 'promo', props: {} };
  if (first === 'more') return { kind: 'tab', tab: 'meer' };

  return { kind: 'tab', tab: 'start' };
}
