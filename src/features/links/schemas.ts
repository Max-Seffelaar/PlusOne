import { z } from 'zod';

const uuid = z.string().uuid();

/** Trimmed free text that treats an empty string as "not provided". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

/** Venue-scoped influencer (86ey21vjt). Admin-only (RLS enforces). */
export const createInfluencerSchema = z.object({
  venueId: uuid,
  name: z.string().trim().min(2, 'Enter a name').max(120),
  handle: optionalText(80),
  notes: optionalText(1000),
});
export type CreateInfluencerInput = z.input<typeof createInfluencerSchema>;

export const updateInfluencerSchema = z.object({
  influencerId: uuid,
  name: z.string().trim().min(2).max(120).optional(),
  // null clears the field; undefined leaves it untouched.
  handle: z.string().trim().min(1).max(80).nullable().optional(),
  notes: z.string().trim().min(1).max(1000).nullable().optional(),
  archived: z.boolean().optional(),
});
export type UpdateInfluencerInput = z.input<typeof updateInfluencerSchema>;

/**
 * Create a request link on an event. Exactly one identity: an influencer or a
 * free label. The slug is server-generated ({base}-{4 random chars}); the base
 * is display-cosmetic and sanitized, the random suffix defeats enumeration.
 */
export const createRequestLinkSchema = z
  .object({
    eventId: uuid,
    influencerId: uuid.optional(),
    label: optionalText(80),
    /** Cosmetic slug base (influencer name / label); sanitized server-side. */
    slugBase: z.string().trim().min(1).max(120),
    tierId: uuid.optional(),
    maxHeadcount: z.coerce.number().int().min(1).max(100000).optional(),
    autoApprove: z.boolean().optional().default(false),
    /** ISO datetime; the link stops taking requests after this moment. */
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine((v) => Boolean(v.influencerId) !== Boolean(v.label), {
    message: 'Pick an influencer or give the link a label (one of the two)',
  })
  .refine((v) => !v.autoApprove || Boolean(v.tierId), {
    message: 'Auto-approve needs a fixed tier',
  });
export type CreateRequestLinkInput = z.input<typeof createRequestLinkSchema>;

/** Partial link update: undefined = untouched, null = cleared. */
export const updateRequestLinkSchema = z.object({
  linkId: uuid,
  influencerId: uuid.nullable().optional(),
  label: z.string().trim().min(1).max(80).nullable().optional(),
  tierId: uuid.nullable().optional(),
  maxHeadcount: z.coerce.number().int().min(1).max(100000).nullable().optional(),
  autoApprove: z.boolean().optional(),
  active: z.boolean().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  archived: z.boolean().optional(),
});
export type UpdateRequestLinkInput = z.input<typeof updateRequestLinkSchema>;
