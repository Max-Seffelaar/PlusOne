/**
 * Remaining mock-data fallbacks still consumed by live po screens while the
 * real Supabase data loads. All other exports were removed after mock→live
 * migration (surface-unification, T1 cleanup).
 */

import type { Venue } from './types';

// Venues the current user is a member of — fallback for the venue switcher
// until usePoVenues resolves.
export const venues: Venue[] = [
  { id: 'lofi', name: 'LOFI', city: 'Amsterdam', plan: 'Premium', roles: ['Admin', 'Finance'], events: 14, current: true },
  { id: 'marktkantine', name: 'De Marktkantine', city: 'Amsterdam', plan: 'Premium', roles: ['Organisator'], events: 8 },
  { id: 'garagenoord', name: 'Garage Noord', city: 'Amsterdam', plan: 'Starter', roles: ['Doorhost'], events: 3 },
];
