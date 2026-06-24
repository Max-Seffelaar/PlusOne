import { z } from 'zod';

const uuid = z.string().uuid();

/** Staff asks for X extra slots with a motivation (#5). */
export const quotaRequestSchema = z.object({
  eventId: uuid,
  requestedExtra: z.coerce.number().int().min(1, 'Ask for at least 1 spot').max(100),
  motivation: z.string().trim().min(1, 'Add a short reason').max(500),
});
export type QuotaRequestInput = z.input<typeof quotaRequestSchema>;

/**
 * Admin sets a member's DEFAULT quota at a venue (#4, role matrix §2). Per-user,
 * not per-role. Written through the venue dashboard; RLS (quotas_*_admin)
 * requires admin + AAL2. 0 means "no personal slots" (the quota engine treats a
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

/** Admin decision on a request: approve (writes the override) or deny (#4/#5). */
export const decideQuotaRequestSchema = z
  .object({
    requestId: uuid,
    decision: z.enum(['approved', 'denied']),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.decision !== 'denied' || (v.reason && v.reason.length > 0), {
    message: 'Give a reason for declining',
    path: ['reason'],
  });
export type DecideQuotaRequestInput = z.input<typeof decideQuotaRequestSchema>;
