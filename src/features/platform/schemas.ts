// Zod schemas for the platform (system) admin surface — open-beta invites
// (P-03, z8uq9m0tnv). CLAUDE.md: all input through Zod, no `any`, no raw
// formData passthrough.

import { z } from 'zod';
import { emailSchema } from '@/features/auth/schemas';

// Free-form operator note ("met Joeri gesproken op ADE"). Never shown to the
// invitee; an empty field is stored as null rather than ''.
export const inviteNoteSchema = z
  .string()
  .trim()
  .max(500, 'Note is too long')
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

export const betaInviteSchema = z.object({
  email: emailSchema,
  note: inviteNoteSchema,
});

export const platformInviteIdSchema = z.object({
  inviteId: z.string().uuid(),
});

export type BetaInviteInput = z.infer<typeof betaInviteSchema>;
