import { z } from 'zod';

const uuid = z.string().uuid();

/** Staff asks for X extra slots with a motivation (#5). */
export const quotaRequestSchema = z.object({
  eventId: uuid,
  requestedExtra: z.coerce.number().int().min(1, 'Vraag minimaal 1 plek aan').max(100),
  motivation: z.string().trim().min(1, 'Geef een korte motivatie').max(500),
});
export type QuotaRequestInput = z.input<typeof quotaRequestSchema>;

/** Admin decision on a request: approve (writes the override) or deny (#4/#5). */
export const decideQuotaRequestSchema = z
  .object({
    requestId: uuid,
    decision: z.enum(['approved', 'denied']),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.decision !== 'denied' || (v.reason && v.reason.length > 0), {
    message: 'Geef een reden bij een afwijzing',
    path: ['reason'],
  });
export type DecideQuotaRequestInput = z.input<typeof decideQuotaRequestSchema>;
