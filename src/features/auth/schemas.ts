// Zod schemas for every auth input (CLAUDE.md: all input through Zod, no `any`,
// no raw formData passthrough). Imported by server actions and client forms so
// validation rules live in exactly one place.

import { z } from 'zod';
import { VENUE_ROLES } from './roles';

// E-mail is normalised (trim + lowercase) so invite/lookup matching is
// case-insensitive and consistent with the DB's lower(email) indexes.
export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Vul een e-mailadres in')
  .max(254, 'E-mailadres is te lang')
  .email('Ongeldig e-mailadres')
  .transform((v) => v.toLowerCase());

// Supabase e-mail OTP is a 6-digit numeric code.
export const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Vul de 6-cijferige code in');

// TOTP codes are also 6 digits.
export const totpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Vul de 6-cijferige code uit je authenticator-app in');

export const uuidSchema = z.string().uuid('Ongeldige id');

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
    .min(1, 'Kies minstens één rol')
    .refine((r) => new Set(r).size === r.length, 'Dubbele rol'),
});

export const profileNameSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, 'Vul je naam in')
    .max(120, 'Naam is te lang'),
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

export type InviteInput = z.infer<typeof inviteSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
