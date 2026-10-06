import { z } from 'zod';

const uuid = z.string().uuid('Invalid id');

/** `exportVenueData` input (legal v0.3 E1): the whole venue, or one event of it. */
export const exportVenueDataSchema = z
  .object({
    venueId: uuid,
    scope: z.union([z.literal('venue'), z.object({ eventId: uuid }).strict()]),
  })
  .strict();

export type ExportVenueDataInput = z.infer<typeof exportVenueDataSchema>;

/** Hard cap per table (plan §3 E1): above this the export refuses with
 *  "export per event" instead of risking a half file on the function timeout. */
export const EXPORT_MAX_ROWS = 50_000;

/** PostgREST page size for every export read. */
export const EXPORT_PAGE_SIZE = 1_000;
