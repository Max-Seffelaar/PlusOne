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

// Venue type shown to guests at check-in / on landing pages. Constrained here
// in Zod, not the DB — it is stored in venues.settings (no column). Mirrors the
// onboarding "Type venue" choice.
export const VENUE_TYPES = ['club', 'festival', 'bar', 'concertzaal'] as const;
export type VenueType = (typeof VENUE_TYPES)[number];

// Self-service venue creation (#40a). Retention bounds match the DB check
// (1..60); address is optional display data. The plan is picked in a later
// onboarding step (set_venue_plan), so it is intentionally NOT collected here.
export const createVenueSchema = z.object({
  name: z.string().trim().min(1, 'Vul een venuenaam in').max(120, 'Naam is te lang'),
  address: z
    .string()
    .trim()
    .max(200, 'Adres is te lang')
    .optional()
    .transform((v) => v ?? ''),
  venueType: z.enum(VENUE_TYPES as unknown as [string, ...string[]]),
  retentionMonths: z.coerce
    .number()
    .int('Vul een geheel aantal maanden in')
    .min(1, 'Minimaal 1 maand')
    .max(60, 'Maximaal 60 maanden')
    .default(12),
});
export type CreateVenueInput = z.input<typeof createVenueSchema>;

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
