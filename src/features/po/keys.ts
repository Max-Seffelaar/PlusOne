// React Query key factory for the po live-data layer (STAP 3.2). One namespace
// under ['po'] so PoLiveProvider's QueryClient can invalidate a whole event
// subtree at once. Consumers arrive in STAP 3.3+ (Events, Gastenlijst, Aanvragen)
// and STAP 3.7/3.8 (the settings cluster: team, profile/sessions, venue, billing).
export const poKeys = {
  all: ['po'] as const,
  events: (venueId: string) => [...poKeys.all, 'events', venueId] as const,
  event: (eventId: string) => [...poKeys.all, 'event', eventId] as const,
  guests: (eventId: string) => [...poKeys.all, 'guests', eventId] as const,
  tiers: (eventId: string) => [...poKeys.all, 'tiers', eventId] as const,
  requests: (eventId: string) => [...poKeys.all, 'requests', eventId] as const,
  quotaRequests: (eventId: string) => [...poKeys.all, 'quota-requests', eventId] as const,
  // Settings cluster — team/quota + invites scope to a venue, sessions/profile to
  // the caller, venue-settings + subscription to a venue.
  team: (venueId: string) => [...poKeys.all, 'team', venueId] as const,
  invites: (venueId: string) => [...poKeys.all, 'invites', venueId] as const,
  sessions: () => [...poKeys.all, 'sessions'] as const,
  profile: (userId: string) => [...poKeys.all, 'profile', userId] as const,
  venueSettings: (venueId: string) => [...poKeys.all, 'venue-settings', venueId] as const,
  subscription: (venueId: string) => [...poKeys.all, 'subscription', venueId] as const,
} as const;
