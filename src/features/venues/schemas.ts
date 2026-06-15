// Zod schemas for every venue-dashboard mutation (CLAUDE.md: all input through
// Zod, no `any`, no raw formData passthrough). Shared by server actions and
// client forms so the rules live in exactly one place.

import { z } from 'zod';
import { VENUE_ROLES } from '@/features/auth/roles';

const uuid = z.string().uuid('Ongeldige id');
const venueRole = z.enum(VENUE_ROLES as unknown as [string, ...string[]]);

// Venue settings (decision #16/#24): display name + AVG retention in months.
// retention bounds match the DB check (retention_months between 1 and 60).
export const venueSettingsSchema = z.object({
  venueId: uuid,
  name: z.string().trim().min(1, 'Vul een venuenaam in').max(120, 'Naam is te lang'),
  retentionMonths: z.coerce
    .number()
    .int('Vul een geheel aantal maanden in')
    .min(1, 'Minimaal 1 maand')
    .max(60, 'Maximaal 60 maanden'),
});

// Change a member's roles (AAL2 — role grant is sensitive). Deduped into
// canonical order so the stored array is stable and the escalation guard sees a
// clean set.
export const memberRolesSchema = z.object({
  venueId: uuid,
  userId: uuid,
  roles: z
    .array(venueRole)
    .min(1, 'Kies minstens één rol')
    .transform((r) => VENUE_ROLES.filter((role) => r.includes(role))),
});

// Remove a membership (decision #24: revokes access to THIS venue only).
export const removeMemberSchema = z.object({
  venueId: uuid,
  userId: uuid,
});

// Switch the active venue in the nav (multi-venue users, decision #1).
export const setActiveVenueSchema = z.object({
  venueId: uuid,
});

export type VenueSettingsInput = z.infer<typeof venueSettingsSchema>;
export type MemberRolesInput = z.infer<typeof memberRolesSchema>;
