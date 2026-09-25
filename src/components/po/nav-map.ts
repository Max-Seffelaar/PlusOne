/**
 * Pure URL/nav mapping for the po shell — which nav entry a screen belongs to,
 * which mobile tab stays lit, and where "back" goes when there is no history.
 *
 * Extracted from `app.tsx` (86eykm76k) so the shell root, the chrome and the
 * screen switch can each import what they need without any of them pulling the
 * others in. Nothing here touches React: they are functions of a parsed URL.
 */
import { screenPath, tabPath, doorPath, type ParsedTarget } from './routes';
import type { TabKey } from './shell';
import type { ScreenName, ScreenProps } from './context';

/** Data-dense screens that opt into the full 1080px desktop column. Forms and
 *  detail-entry screens stay at the narrow reading column (640px). (S3.3)
 *
 *  Despite the name this is the content-column map for EVERY width (T1): the
 *  tablet bottom-tab chrome (641–1023px) centers the same column, so a form
 *  reads at 640px on an iPad portrait exactly as it does on a laptop. A phone
 *  (≤640px) is full-bleed because the viewport is narrower than any column.
 *  The name stays — CLAUDE.md and the tests refer to it. */
export const WIDE_DESKTOP = new Set([
  'start', 'events', 'guests', 'lijst', 'stats', 'audit', 'gebruikers',
  'event', 'pastevent', 'aanvragen', 'deur', 'platform', 'platformvenues', 'platformaudit',
]);

/** Mobile only has 5 real bottom tabs — collapse every desktop-only sidebar
 *  entry (Contacts/Requests/Analytics/Promotion/Team) onto "Meer", matching
 *  where those screens actually live in the mobile nav. */
const MOBILE_TABS: ReadonlySet<string> = new Set(['start', 'events', 'guests', 'deur', 'meer']);

/** Which top-level nav entry a pushed screen visually belongs to (G1): drives
 *  the desktop sidebar's `active` highlight and — collapsed onto the 5 mobile
 *  bottom tabs by `mobileTabForScreen` below — which tab stays lit while a
 *  pushed screen is open. Replaces the old NAV_PUSHED/currentKey lookup: real
 *  URLs don't carry "which tab you pushed from", so this is a static, per-screen
 *  mapping instead of a runtime-preserved `tab` value.
 *
 *  `guest` always maps to 'guests', matching its real URL taxonomy
 *  (`/app/guests/:id`, never nested under an event) — NOT `props.eventId ? …`.
 *  `eventId` there is the "originating event pinned on top" display scope
 *  (passed by both the Guests-tab list AND an event's guest list, since every
 *  guest belongs to some event), not a signal for which nav item pushed the
 *  screen; branching nav highlighting on it was wrong in both directions (a
 *  Guests-tab guest always has a truthy eventId → wrongly highlighted Events,
 *  while the past-event recap's guest links omit eventId → wrongly highlighted
 *  Guests). There's no reliable "who pushed this" signal without threading a
 *  new field through routes.ts purely for cosmetics — not worth it. */
export function navKeyForScreen(name: ScreenName, _props: ScreenProps): string {
  switch (name) {
    case 'event':
    case 'eventedit':
    case 'lijst':
    case 'tiers':
    case 'crew':
    case 'allowance':
    case 'links':
    case 'quickadd':
    case 'bulk':
    case 'pastevent':
      return 'events';
    case 'guest':
      return 'guests';
    case 'contacten':
    case 'contactprofile':
      return 'contacten';
    case 'aanvragen':
      return 'aanvragen';
    case 'stats':
      return 'stats';
    case 'promotion':
      return 'promotion';
    case 'gebruikers':
      return 'gebruikers';
    case 'platform':
    case 'platformvenues':
    case 'platformaudit':
      return 'platform';
    default:
      // rollen, import, venueswitch, venuesettings, venuecreate, profile,
      // billing, audit, adminsessions, templates, templateedit — all live
      // under the More hub on both mobile and desktop.
      return 'meer';
  }
}

export function mobileTabForScreen(name: ScreenName, props: ScreenProps): TabKey {
  const key = navKeyForScreen(name, props);
  return (MOBILE_TABS.has(key) ? key : 'meer') as TabKey;
}

/** Best-effort parent path for a screen with no real browser-history entry to
 *  pop (G1 review): a cold deep link — fresh tab, bookmark, or the consent/MFA
 *  `next=` round-trip — has nothing "before" it in THIS tab's history, so
 *  `router.back()` would either no-op or leave the app/land on an unrelated
 *  prior page. `back()`/`closeOverlay` fall through to pushing this instead.
 *  Event-nested screens zoom out one level (to their event, or its guest
 *  list); everything else falls back to its tab, via the same
 *  `mobileTabForScreen` mapping the sidebar/bottom-tab highlight uses. */
export function parentPathFor(target: ParsedTarget): string {
  if (target.kind === 'tab') return tabPath('start');
  if (target.kind === 'door') {
    return target.overlay ? doorPath({ seg: target.seg, eventId: target.eventId ?? undefined }) : tabPath('start');
  }
  const { name, props } = target;
  switch (name) {
    case 'eventedit':
      return props.isNew ? tabPath('events') : screenPath('event', { id: props.id });
    case 'lijst':
    case 'tiers':
    case 'crew':
    case 'links':
      return screenPath('event', { id: props.id });
    case 'quickadd':
    case 'bulk':
      return props.id ? screenPath('lijst', { id: props.id }) : tabPath('events');
    case 'event':
    case 'pastevent':
      return tabPath('events');
    case 'guest':
      return props.eventId ? screenPath('lijst', { id: props.eventId }) : tabPath('guests');
    case 'contactprofile':
      return tabPath('guests');
    case 'templateedit':
      return screenPath('templates', {});
    default:
      // mobileTabForScreen's declared return type includes 'deur', but
      // navKeyForScreen never yields it for a `kind: 'screen'` target (that
      // key is reserved for `kind: 'door'`, handled above) — safe to narrow.
      return tabPath(mobileTabForScreen(name, props) as Exclude<TabKey, 'deur'>);
  }
}

/** Where the venue card leads: the desktop sidebar header and the mobile More
 *  hub's top card (z8uq9m0hw2). With exactly one venue there is nothing to
 *  switch to, so it opens that venue's settings, but only for a role that may
 *  see them (admin, finance). Everyone else keeps the switcher: it still shows
 *  their venue and roles and holds "Add a new venue", where venue settings would
 *  only say "no rights". Zero or 2+ venues: the switcher, unchanged. */
export function venueEntryScreen(venueCount: number, canViewSettings: boolean): 'venuesettings' | 'venueswitch' {
  return venueCount === 1 && canViewSettings ? 'venuesettings' : 'venueswitch';
}
