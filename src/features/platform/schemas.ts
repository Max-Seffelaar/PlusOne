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

// "Free until end of ADE" (Onboarding A, z8uq9m2vg5): the form sends 'true'
// when ticked; absent or 'false' is false, anything else is refused. Stored on
// platform_invites.free_until_ade; create_venue_with_owner reads it from
// there, never from the mail or metadata.
export const inviteFreeUntilAdeSchema = z
  .union([z.literal('true'), z.literal('false'), z.null(), z.undefined()])
  .transform((v) => v === 'true');

export const betaInviteSchema = z.object({
  email: emailSchema,
  note: inviteNoteSchema,
  freeUntilAde: inviteFreeUntilAdeSchema,
});

export const platformInviteIdSchema = z.object({
  inviteId: uuidSchema,
});

export type BetaInviteInput = z.infer<typeof betaInviteSchema>;
