// React Query key factory for the po live-data layer (STAP 3.2). One namespace
// under ['po'] so PoLiveProvider's QueryClient can invalidate a whole event
// subtree at once. Consumers arrive in STAP 3.3+ (Events, Gastenlijst, Aanvragen).
export const poKeys = {
  all: ['po'] as const,
  events: (venueId: string) => [...poKeys.all, 'events', venueId] as const,
  event: (eventId: string) => [...poKeys.all, 'event', eventId] as const,
  guests: (eventId: string) => [...poKeys.all, 'guests', eventId] as const,
  tiers: (eventId: string) => [...poKeys.all, 'tiers', eventId] as const,
  requests: (eventId: string) => [...poKeys.all, 'requests', eventId] as const,
  quotaRequests: (eventId: string) => [...poKeys.all, 'quota-requests', eventId] as const,
} as const;
