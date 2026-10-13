import { z } from 'zod';
import { PLUS_ONES_MAX } from '@/features/guests/quick-add-parser';

const uuid = z.string().uuid();

/** Empty string from a form field -> null (optional, dataminimalisatie #9). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/**
 * The guest the extra slots are for (z8uq9m2xyp). Optional on a request; on
 * approval approve_quota_request adds exactly this guest on the requester's
 * name. Same bounds as the guests form (name 500, +N 0..PLUS_ONES_MAX, phone
 * 40) and as the DB CHECK quota_guest_payload_is_valid.
 */
export const quotaGuestSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(500),
  plusOnes: z.number().int().min(0).max(PLUS_ONES_MAX),
  tierId: uuid,
  phone: optionalText(40),
  note: optionalText(500),
});
export type QuotaGuestInput = z.input<typeof quotaGuestSchema>;

/** Staff asks for X extra slots with a motivation (#5), optionally naming the guest. */
export const quotaRequestSchema = z.object({
  eventId: uuid,
  requestedExtra: z.coerce.number().int().min(1, 'Ask for at least 1 spot').max(100),
  motivation: z.string().trim().min(1, 'Add a short reason').max(500),
  guest: quotaGuestSchema.optional(),
});
export type QuotaRequestInput = z.input<typeof quotaRequestSchema>;

/** The requester dismisses a decision on Home (z8uq9m2xyp). */
export const markQuotaRequestSeenSchema = z.object({ requestId: uuid });
export type MarkQuotaRequestSeenInput = z.input<typeof markQuotaRequestSeenSchema>;

/**
 * Admin sets a member's DEFAULT quota at a venue (#4, role matrix §2). Per-user,
 * not per-role. Written through the venue dashboard; RLS (quotas_*_admin)
 * requires admin (role-only, no AAL2). 0 means "no personal slots" (the quota engine treats a
 * missing row as 0 too).
 */
export const defaultQuotaSchema = z.object({
  venueId: uuid,
  userId: uuid,
  defaultCount: z.coerce
    .number()
    .int('Enter a whole number')
    .min(0, 'At least 0')
    .max(100000, "That's a lot"),
});
export type DefaultQuotaInput = z.input<typeof defaultQuotaSchema>;

/**
 * What the admin changed before approving (z8uq9m5kux). Each field is optional
 * and means "as asked" when left out; approve_quota_request re-checks every
 * bound (extra 1..requested, plus-ones 0..asked, a tier of the same event).
 */
export const quotaAdjustSchema = z.object({
  // No upper bound here: the cap is the request's own requested_extra, which
  // approve_quota_request enforces (a raw insert may exceed the form's 100).
  extra: z.number().int().min(1).optional(),
  tierId: uuid.optional(),
  plusOnes: z.number().int().min(0).max(PLUS_ONES_MAX).optional(),
});
export type QuotaAdjustInput = z.input<typeof quotaAdjustSchema>;

/** Admin decision on a request: approve (writes the override, optionally
 *  adjusted) or deny (#4/#5). */
export const decideQuotaRequestSchema = z
  .object({
    requestId: uuid,
    decision: z.enum(['approved', 'denied']),
    reason: z.string().trim().max(500).optional(),
    adjust: quotaAdjustSchema.optional(),
  })
  .refine((v) => v.decision !== 'denied' || (v.reason && v.reason.length > 0), {
    message: 'Give a reason for declining',
    path: ['reason'],
  })
  .refine((v) => v.decision === 'approved' || v.adjust === undefined, {
    message: 'Only an approval can be adjusted',
    path: ['adjust'],
  });
export type DecideQuotaRequestInput = z.input<typeof decideQuotaRequestSchema>;
