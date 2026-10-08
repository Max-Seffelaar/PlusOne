// Zod schemas for the platform (system) admin surface — open-beta invites
// (P-03, z8uq9m0tnv). CLAUDE.md: all input through Zod, no `any`, no raw
// formData passthrough.

import { z } from 'zod';
import { emailSchema, uuidSchema } from '@/features/auth/schemas';

// Free-form operator note ("met Joeri gesproken op ADE"). Never shown to the
// invitee; an empty field is stored as null rather than ''.
export const inviteNoteSchema = z
  .string()
  .trim()
  .max(500, 'Note is too long')
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

// "Always free" (Onboarding A, z8uq9m2vg5): the form sends 'true' when ticked.
// Anything else (absent, 'false') is false. Stored on platform_invites.comped;
// create_venue_with_owner reads it from there, never from the mail or metadata.
export const inviteCompedSchema = z
  .union([z.literal('true'), z.literal('false'), z.null(), z.undefined()])
  .transform((v) => v === 'true');

export const betaInviteSchema = z.object({
  email: emailSchema,
  note: inviteNoteSchema,
  comped: inviteCompedSchema,
});

export const platformInviteIdSchema = z.object({
  inviteId: uuidSchema,
});

export type BetaInviteInput = z.infer<typeof betaInviteSchema>;
