// React Query key factory for the po live-data layer (STAP 3.2). One namespace
// under ['po'] so PoLiveProvider's QueryClient can invalidate a whole event
// subtree at once. Consumers arrive in STAP 3.3+ (Events, Gastenlijst, Aanvragen)
// and STAP 3.7/3.8 (the settings cluster: team, profile/sessions, venue, billing).
export const poKeys = {
  all: ['po'] as const,
  events: (venueId: string) => [...poKeys.all, 'events', venueId] as const,
  /** Mobile Dashboard-home (S11): the venue's candidate events + headcounts. */
  home: (venueId: string) => [...poKeys.all, 'home', venueId] as const,
  /** Home KPI bundle for the selected event (open requests + personal quota). */
  homeStats: (eventId: string) => [...poKeys.all, 'home-stats', eventId] as const,
  /** The venue's "current" event for the mobile Deur/Taken tab (live → next → recent). */
  doorEvent: (venueId: string) => [...poKeys.all, 'door-event', venueId] as const,
  /** All non-closed events the door/cockpit may work, for the Deur-tab switcher (S1.3). */
  doorCandidates: (venueId: string) => [...poKeys.all, 'door-candidates', venueId] as const,
  event: (eventId: string) => [...poKeys.all, 'event', eventId] as const,
  eventDetail: (eventId: string) => [...poKeys.all, 'event-detail', eventId] as const,
  eventRecap: (eventId: string) => [...poKeys.all, 'event-recap', eventId] as const,
  guests: (eventId: string) => [...poKeys.all, 'guests', eventId] as const,
  /** The venue-wide "all guests" list (Guests tab, no event selected); keyed on the
   *  venue + the joined event-id set so it re-reads when the event set changes. */
  venueGuests: (venueId: string, eventKey: string) => [...poKeys.all, 'venue-guests', venueId, eventKey] as const,
  tiers: (eventId: string) => [...poKeys.all, 'tiers', eventId] as const,
  // External crew (event_organizers, #6/#24) for an event + the assignable
  // team-member pool for the "add an existing member" path. Both key on the event.
  crew: (eventId: string) => [...poKeys.all, 'crew', eventId] as const,
  assignableCrew: (eventId: string) => [...poKeys.all, 'assignable-crew', eventId] as const,
  /** Venue-wide external crew (Team screen section 2, T8). Crew mutations key on
   *  the event, so they invalidate the ['po','venue-crew'] PREFIX. */
  venueCrew: (venueId: string) => [...poKeys.all, 'venue-crew', venueId] as const,
  /** Live event-day stats (per-quarter instroom + peak) for the cockpit (S13). */
  eventStats: (eventId: string) => [...poKeys.all, 'event-stats', eventId] as const,
  /** Active check-in arrivals per guest (actual present koppen + partial) — cockpit (S13). */
  arrivals: (eventId: string) => [...poKeys.all, 'arrivals', eventId] as const,
  quota: (eventId: string) => [...poKeys.all, 'quota', eventId] as const,
  // The approval inbox (S5) reads venue-wide (all events at once) so it can show
  // "Alle events" + an event picker, so these scope to the VENUE. Mutations
  // invalidate the [...all,'requests'] / [...all,'quota-requests'] PREFIX, which
  // matches the venue key regardless of which event a decided request belonged to.
  requests: (venueId: string) => [...poKeys.all, 'requests', venueId] as const,
  quotaRequests: (venueId: string) => [...poKeys.all, 'quota-requests', venueId] as const,
  // Address book (S3) — contacts scope to a venue; the optional search term keys
  // distinct cached lists, so invalidating the ['po','contacts',venueId] prefix
  // refreshes every variant after a star/import/add write.
  contacts: (venueId: string, search = '') => [...poKeys.all, 'contacts', venueId, search] as const,
  contactKeys: (venueId: string) => [...poKeys.all, 'contact-keys', venueId] as const,
  /** A single contact's full profile (header + cross-event appearances + timeline). */
  contactProfile: (contactId: string) => [...poKeys.all, 'contact-profile', contactId] as const,
  // Settings cluster — team/quota + invites scope to a venue, sessions/profile to
  // the caller, venue-settings + subscription to a venue.
  team: (venueId: string) => [...poKeys.all, 'team', venueId] as const,
  /** Per-event quota overrides (Allowance screen, event_quotas), keyed on the event. */
  allowance: (eventId: string) => [...poKeys.all, 'allowance', eventId] as const,
  invites: (venueId: string) => [...poKeys.all, 'invites', venueId] as const,
  /** Invites addressed to the signed-in user (incoming "accept invite" banner). */
  myInvites: () => [...poKeys.all, 'my-invites'] as const,
  sessions: () => [...poKeys.all, 'sessions'] as const,
  /** A team member's active sessions for the admin remote-logout screen. */
  userSessions: (targetUserId: string) => [...poKeys.all, 'user-sessions', targetUserId] as const,
  profile: (userId: string) => [...poKeys.all, 'profile', userId] as const,
  venueSettings: (venueId: string) => [...poKeys.all, 'venue-settings', venueId] as const,
  subscription: (venueId: string) => [...poKeys.all, 'subscription', venueId] as const,
  // Event templates (86exyp8gn) — reusable per-event-type setups scope to a venue;
  // a single template + its tier list key on the template id.
  templates: (venueId: string) => [...poKeys.all, 'templates', venueId] as const,
  template: (templateId: string) => [...poKeys.all, 'template', templateId] as const,
  templateTiers: (templateId: string) => [...poKeys.all, 'template-tiers', templateId] as const,
  // Audit log (S10) — the feed keys on venue + the active filters; options
  // (events/members for the filter sheet) on the venue; per-guest history on the
  // guest. All under ['po'] so a venue switch clears them with the rest.
  audit: (venueId: string, filters: Record<string, unknown>) =>
    [...poKeys.all, 'audit', venueId, filters] as const,
  auditOptions: (venueId: string) => [...poKeys.all, 'audit-options', venueId] as const,
  guestHistory: (guestId: string) => [...poKeys.all, 'guest-history', guestId] as const,
  /** Per-tier + per-member stats for the event Activity section (86ey21vnd). */
  eventActivity: (eventId: string) => [...poKeys.all, 'event-activity', eventId] as const,
  // Request links + influencers (Requests-epic F1, 86ey21vjt) — one event's links
  // with their funnel numbers; the venue-wide lean link list (approvals filter);
  // the venue's influencer roster. Mutations invalidate by the same prefixes.
  requestLinks: (eventId: string) => [...poKeys.all, 'request-links', eventId] as const,
  venueLinks: (venueId: string) => [...poKeys.all, 'venue-links', venueId] as const,
  influencers: (venueId: string) => [...poKeys.all, 'influencers', venueId] as const,
  // Promotion dashboard (F2, 86ey6b3fe) — the per-event link funnel plus the two
  // venue-wide range-scoped reads (leaderboard + label-only links). Link writes
  // invalidate the ['po','link-funnel'] / ['po','promo'] prefixes.
  linkFunnel: (eventId: string) => [...poKeys.all, 'link-funnel', eventId] as const,
  promoLeaderboard: (venueId: string, range: string) =>
    [...poKeys.all, 'promo', venueId, 'leaderboard', range] as const,
  promoLabelFunnel: (venueId: string, range: string) =>
    [...poKeys.all, 'promo', venueId, 'labels', range] as const,
} as const;
