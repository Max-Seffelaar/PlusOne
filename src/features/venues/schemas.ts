// Zod schemas for every venue-dashboard mutation (CLAUDE.md: all input through
// Zod, no `any`, no raw formData passthrough). Shared by server actions and
// client forms so the rules live in exactly one place.

import { z } from 'zod';
import { VENUE_ROLES } from '@/features/auth/roles';

const uuid = z.string().uuid('Ongeldige id');
const venueRole = z.enum(VENUE_ROLES as unknown as [string, ...string[]]);

// Optional free-text field from a form: trim, and treat empty as NULL so the DB
// stores a clean null rather than ''.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'Te lang')
    .transform((v) => (v === '' ? null : v));

// Venue settings (decision #16/#24): name + AVG retention + company/legal/finance/
// address data (mirrors the onboarding VenueCreate fields) + the venue-wide
// default personal quota. retention bounds match the DB check (1..60).
export const venueSettingsSchema = z.object({
  venueId: uuid,
  name: z.string().trim().min(1, 'Vul een venuenaam in').max(120, 'Naam is te lang'),
  retentionMonths: z.coerce
    .number()
    .int('Vul een geheel aantal maanden in')
    .min(1, 'Minimaal 1 maand')
    .max(60, 'Maximaal 60 maanden'),
  companyName: optionalText(200),
  kvkNumber: optionalText(20).refine(
    (v) => v === null || /^\d{8}$/.test(v),
    'KvK-nummer bestaat uit 8 cijfers'
  ),
  vatNumber: optionalText(20),
  financeEmail: optionalText(254)
    .transform((v) => (v ? v.toLowerCase() : v))
    .refine(
      (v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Ongeldig e-mailadres'
    ),
  addressLine: optionalText(200),
  postalCode: optionalText(16),
  city: optionalText(120),
  // country is NOT NULL in the DB; default to NL when left blank.
  country: z
    .string()
    .trim()
    .max(56, 'Te lang')
    .transform((v) => (v === '' ? 'NL' : v)),
  defaultPersonalQuota: z.coerce
    .number()
    .int('Vul een geheel getal in')
    .min(0, 'Minimaal 0')
    .max(100000, 'Dat is wel erg veel'),
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
