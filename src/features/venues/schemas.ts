// Zod schemas for every venue-dashboard mutation (CLAUDE.md: all input through
// Zod, no `any`, no raw formData passthrough). Shared by server actions and
// client forms so the rules live in exactly one place.

import { z } from 'zod';
import { VENUE_ROLES } from '@/features/auth/roles';

const uuid = z.string().uuid('Invalid id');
const venueRole = z.enum(VENUE_ROLES as unknown as [string, ...string[]]);

// Optional free-text field from a form: trim, and treat empty as NULL so the DB
// stores a clean null rather than ''.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'Too long')
    .transform((v) => (v === '' ? null : v));

// Venue settings (decision #16/#24): name + AVG retention + company/legal/finance/
// address data (mirrors the onboarding VenueCreate fields) + the venue-wide
// default personal quota. retention bounds match the DB check (1..60).
export const venueSettingsSchema = z.object({
  venueId: uuid,
  name: z.string().trim().min(1, 'Enter a venue name').max(120, 'Name is too long'),
  retentionMonths: z.coerce
    .number()
    .int('Enter a whole number of months')
    .min(1, 'At least 1 month')
    .max(60, 'At most 60 months'),
  companyName: optionalText(200),
  kvkNumber: optionalText(20).refine(
    (v) => v === null || /^\d{8}$/.test(v),
    'KVK number is 8 digits'
  ),
  vatNumber: optionalText(20),
  financeEmail: optionalText(254)
    .transform((v) => (v ? v.toLowerCase() : v))
    .refine(
      (v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Invalid email'
    ),
  addressLine: optionalText(200),
  postalCode: optionalText(16),
  city: optionalText(120),
  // country is NOT NULL in the DB; default to NL when left blank.
  country: z
    .string()
    .trim()
    .max(56, 'Too long')
    .transform((v) => (v === '' ? 'NL' : v)),
  defaultPersonalQuota: z.coerce
    .number()
    .int('Enter a whole number')
    .min(0, 'At least 0')
    .max(100000, "That's a lot"),
  // Company-wide "uitchecken toestaan" default (#3 / S1.1). The form sends a
  // 'true'/'false' toggle string; coerce to a real boolean.
  allowUncheck: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

// Venue type shown to guests at check-in / on landing pages. Constrained here
// in Zod, not the DB — it is stored in venues.settings (no column). Mirrors the
// onboarding "Type venue" choice.
export const VENUE_TYPES = ['club', 'festival', 'bar', 'concertzaal'] as const;
export type VenueType = (typeof VENUE_TYPES)[number];

// Self-service venue creation (#40a). Retention bounds match the DB check
// (1..60); address is optional display data. The plan is picked in a later
// onboarding step (set_venue_plan), so it is intentionally NOT collected here.
//
// The company/billing fields below are OPTIONAL: the onboarding wizard omits them
// (set later in Venue Settings), while the in-app "New venue" switcher quick-create
// captures them so they persist in the same create transaction. Rules mirror
// venueSettingsSchema so both creation paths validate identically.
export const createVenueSchema = z.object({
  name: z.string().trim().min(1, 'Enter a venue name').max(120, 'Name is too long'),
  address: z
    .string()
    .trim()
    .max(200, 'Address is too long')
    .optional()
    .transform((v) => v ?? ''),
  venueType: z.enum(VENUE_TYPES as unknown as [string, ...string[]]),
  retentionMonths: z.coerce
    .number()
    .int('Enter a whole number of months')
    .min(1, 'At least 1 month')
    .max(60, 'At most 60 months')
    .default(12),
  kvkNumber: optionalText(20)
    .optional()
    .refine((v) => v == null || /^\d{8}$/.test(v), 'KVK number is 8 digits'),
  vatNumber: optionalText(20).optional(),
  financeEmail: optionalText(254)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : v))
    .refine(
      (v) => v == null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Invalid email'
    ),
  city: optionalText(120).optional(),
  // Switcher quick-create → make a ready-to-use venue: skip the onboarding resume
  // guard and stamp settings.onboarding.completed=true (so /app does not bounce
  // the owner into the wizard). The wizard omits this → false.
  complete: z.boolean().optional().default(false),
  // Legal consent (#40): the creator must accept the Terms + Privacy Policy to
  // create a venue. Enforced in the action; the accepted version is stamped
  // server-side from TERMS_VERSION (never trusted from the client).
  termsAccepted: z.boolean().default(false),
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
    .min(1, 'Pick at least one role')
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
