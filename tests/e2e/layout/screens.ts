import { doorPath, screenPath, tabPath } from '@/components/po/routes';

/**
 * Every `po` screen reachable through `routes.ts`, with the seed user whose
 * role actually sees it. URLs are BUILT with the app's own
 * `screenPath`/`tabPath`/`doorPath`, never hand-typed, so a route rename moves
 * this list with it (and a screen that stops existing fails to type-check).
 *
 * Seed ids (supabase/seed.sql): Club Vesper, its always-upcoming event
 * "PLUSONE Launch Night", guest Juri Braakman, contact Sanne Mulder.
 *
 * Users:
 *   admin@ — Max, venue admin at both venues; `pnpm dev:mfa` (run by the CI job
 *            before the suite) stamps his TOTP (dev-login completes AAL2) and
 *            makes him a platform admin, so the Platform screens render their
 *            real content instead of the "not available" state.
 *   door@  — Lisa, doorhost + staff at Club Vesper: the everyday door/staff
 *            view of the tab roots, and the Deur tab itself.
 */
export const SEED = {
  venueId: 'aa000000-0000-7000-8000-000000000001',
  eventId: 'ee000000-0000-7000-8000-000000000001',
  guestId: 'cc000000-0000-7000-8000-000000000001',
  contactId: 'c0000000-0000-7000-8000-000000000001',
} as const;

export const USERS = {
  admin: { email: 'admin@plusone.test', id: '11111111-1111-4111-8111-111111111111' },
  door: { email: 'door@plusone.test', id: '66666666-6666-4666-8666-666666666666' },
} as const;

export type LayoutUser = keyof typeof USERS;

export interface LayoutScreen {
  /** Stable id: test titles, screenshot file names and `known-issues.ts` keys. */
  id: string;
  user: LayoutUser;
  path: string;
}

const EV = SEED.eventId;

export const LAYOUT_SCREENS: readonly LayoutScreen[] = [
  // ── Tab roots, as the doorhost/staff user sees them ──
  { id: 'home.door', user: 'door', path: tabPath('start') },
  { id: 'events.door', user: 'door', path: tabPath('events') },
  { id: 'guests.door', user: 'door', path: tabPath('guests') },
  { id: 'more.door', user: 'door', path: tabPath('meer') },
  { id: 'checkin.door', user: 'door', path: doorPath({ eventId: EV }) },
  { id: 'tasks.door', user: 'door', path: doorPath({ seg: 'taken', eventId: EV }) },

  // ── Tab roots, as the admin sees them (more nav, more badges, more cards) ──
  { id: 'home.admin', user: 'admin', path: tabPath('start') },
  { id: 'events.admin', user: 'admin', path: tabPath('events') },
  { id: 'guests.admin', user: 'admin', path: tabPath('guests') },
  { id: 'more.admin', user: 'admin', path: tabPath('meer') },

  // ── Event-scoped screens ──
  { id: 'event', user: 'admin', path: screenPath('event', { id: EV }) },
  { id: 'eventedit', user: 'admin', path: screenPath('eventedit', { id: EV }) },
  { id: 'eventedit.new', user: 'admin', path: screenPath('eventedit', { isNew: true }) },
  { id: 'lijst', user: 'admin', path: screenPath('lijst', { id: EV }) },
  { id: 'tiers', user: 'admin', path: screenPath('tiers', { id: EV }) },
  { id: 'crew', user: 'admin', path: screenPath('crew', { id: EV }) },
  { id: 'links', user: 'admin', path: screenPath('links', { id: EV }) },
  { id: 'quickadd', user: 'admin', path: screenPath('quickadd', { id: EV }) },
  { id: 'bulk', user: 'admin', path: screenPath('bulk', { id: EV }) },
  { id: 'pastevent', user: 'admin', path: screenPath('pastevent', { id: EV }) },

  // ── Guests & contacts ──
  { id: 'guest', user: 'admin', path: screenPath('guest', { id: SEED.guestId, eventId: EV }) },
  { id: 'contacten', user: 'admin', path: screenPath('contacten') },
  { id: 'contactprofile', user: 'admin', path: screenPath('contactprofile', { id: SEED.contactId }) },
  { id: 'import', user: 'admin', path: screenPath('import') },

  // ── Requests, team, quota ──
  { id: 'aanvragen', user: 'admin', path: screenPath('aanvragen') },
  { id: 'aanvragen.quota', user: 'admin', path: screenPath('aanvragen', { tab: 'quota' }) },
  { id: 'rollen', user: 'admin', path: screenPath('rollen') },
  { id: 'gebruikers', user: 'admin', path: screenPath('gebruikers') },
  { id: 'allowance', user: 'admin', path: screenPath('allowance') },

  // ── Venue, profile, billing ──
  { id: 'venuesettings', user: 'admin', path: screenPath('venuesettings') },
  { id: 'venueswitch', user: 'admin', path: screenPath('venueswitch') },
  { id: 'venuecreate', user: 'admin', path: screenPath('venuecreate') },
  { id: 'profile', user: 'admin', path: screenPath('profile') },
  { id: 'billing', user: 'admin', path: screenPath('billing') },

  // ── Insight & admin ──
  { id: 'stats', user: 'admin', path: screenPath('stats') },
  { id: 'audit', user: 'admin', path: screenPath('audit') },
  { id: 'adminsessions', user: 'admin', path: screenPath('adminsessions') },
  { id: 'templates', user: 'admin', path: screenPath('templates') },
  { id: 'templateedit.new', user: 'admin', path: screenPath('templateedit', { isNew: true }) },

  // ── Promotion hub ──
  { id: 'promotion', user: 'admin', path: screenPath('promotion') },
  { id: 'promotion.roster', user: 'admin', path: screenPath('promotion', { tab: 'roster' }) },
  { id: 'promotion.events', user: 'admin', path: screenPath('promotion', { tab: 'events' }) },
  { id: 'promotion.event', user: 'admin', path: screenPath('promotion', { tab: 'events', id: EV }) },

  // ── Platform (platform admins only) ──
  { id: 'platform', user: 'admin', path: screenPath('platform') },
  { id: 'platformvenues', user: 'admin', path: screenPath('platformvenues') },
  { id: 'platformaudit', user: 'admin', path: screenPath('platformaudit') },
];
