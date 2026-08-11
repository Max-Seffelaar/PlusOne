// Zod schemas for every auth input (CLAUDE.md: all input through Zod, no `any`,
// no raw formData passthrough). Imported by server actions and client forms so
// validation rules live in exactly one place.

import { z } from 'zod';
import type { EmailOtpType } from '@supabase/supabase-js';
import { VENUE_ROLES } from './roles';

// E-mail is normalised (trim + lowercase) so invite/lookup matching is
// case-insensitive and consistent with the DB's lower(email) indexes.
export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter an email')
  .max(254, 'Email is too long')
  .email('Invalid email')
  .transform((v) => v.toLowerCase());

// Supabase e-mail OTP is a 6-digit numeric code.
export const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code');

// TOTP codes are also 6 digits.
export const totpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app');

// The link-verification types auth/confirm/route.ts accepts. `EmailOtpType` in
// auth-js is an OPEN union (`... | (string & {})`), so `satisfies
// z.ZodType<EmailOtpType>` enforces nothing at compile time — a trimmed or
// misspelled list still typechecks. This is a hand-maintained subset of the
// six values GoTrue actually accepts for link-based verification;
// route.test.ts pins the exact list so drift is caught at test time instead.
// Lives here (not in route.ts) because a Next.js Route Handler file may only
// export the handful of names Next recognizes (GET, POST, config, …) — any
// other named export fails the production build with "is not a valid Route
// export field".
export const emailOtpTypeSchema = z.enum([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]) satisfies z.ZodType<EmailOtpType>;

export const uuidSchema = z.string().uuid('Invalid id');

export const venueRoleSchema = z.enum(
  VENUE_ROLES as unknown as [string, ...string[]]
);

export const requestOtpSchema = z.object({
  email: emailSchema,
});

export const verifyOtpSchema = z.object({
  email: emailSchema,
  token: otpSchema,
});

export const inviteSchema = z.object({
  venueId: uuidSchema,
  email: emailSchema,
  roles: z
    .array(venueRoleSchema)
    .min(1, 'Pick at least one role')
    .refine((r) => new Set(r).size === r.length, 'Duplicate role'),
  // Optional guest quota seeded as the new member's venue default on acceptance
  // (#4). Blank → undefined → nothing seeded. The form sends a string, so coerce.
  defaultQuota: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce
      .number({ invalid_type_error: 'Quota must be a number' })
      .int('Quota must be a whole number')
      .min(0, "Quota can't be negative")
      .max(9999, 'Quota is too high')
      .optional()
  ),
  // Optional event-organizer scope (#6/#24): events of THIS venue the invitee is
  // granted on acceptance. formData.getAll → string[] (or [] when none). Admin-only;
  // the action re-checks the caller is an admin and that the events are in-venue.
  eventIds: z.preprocess(
    (v) => (Array.isArray(v) ? v : v == null ? [] : [v]),
    z.array(uuidSchema).max(200, 'Too many events').default([])
  ),
});

export const profileNameSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, 'Enter your name')
    .max(120, 'Name is too long'),
});

// Profile is global to the user (decision #24): first/last name + phone. full_name
// is kept as a display mirror, maintained by the action from first + last.
export const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(80, 'Too long'),
  lastName: z.string().trim().min(1, 'Enter your last name').max(120, 'Too long'),
  phone: z
    .string()
    .trim()
    .max(40, 'Too long')
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || /^[+0-9 ()-]{6,40}$/.test(v), 'Invalid phone number'),
});

export const emailChangeSchema = z.object({
  email: emailSchema,
});

export const sessionIdSchema = z.object({
  sessionId: uuidSchema,
});

export const adminSessionsSchema = z.object({
  targetUserId: uuidSchema,
});

export const revokeInviteSchema = z.object({
  inviteId: uuidSchema,
});

export const resendInviteSchema = z.object({
  inviteId: uuidSchema,
});

export type InviteInput = z.infer<typeof inviteSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
