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

/**
 * Public landing-page submission (#12). Name is the only required field; the
 * rest is optional (#9: more data is better, but never mandatory). `company` is
 * a honeypot — a hidden field real users leave empty; the server action drops
 * the request silently when it is filled.
 */
export const submitGuestRequestSchema = z.object({
  // The slug comes from the route, not user input, but we still validate shape.
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/i, 'Ongeldige link'),
  fullName: z.string().trim().min(2, 'Vul je naam in').max(120),
  email: z
    .string()
    .trim()
    .max(254)
    .email('Ongeldig e-mailadres')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Phone arrives already normalised to E.164 by the form (dial code + number);
  // it must carry a country code or it is useless to the venue.
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, 'Ongeldig telefoonnummer')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  plusOnes: z.coerce.number().int().min(0).max(20).default(0),
  motivation: optionalText(1000),
  // Marketing consent (AVG) — opt-in, defaults to false.
  marketingOptIn: z.boolean().optional().default(false),
  // Honeypot — must stay empty. Anything here means "bot".
  company: z.string().max(200).optional(),
});
export type SubmitGuestRequestInput = z.input<typeof submitGuestRequestSchema>;

/** Admin/organizer approves a landing request and assigns a tier (#12/#31). */
export const approveGuestRequestSchema = z.object({
  requestId: uuid,
  tierId: uuid,
  eventId: uuid.optional(),
});
export type ApproveGuestRequestInput = z.input<typeof approveGuestRequestSchema>;

/** Admin/organizer denies a landing request with a mandatory reason (#12). */
export const denyGuestRequestSchema = z.object({
  requestId: uuid,
  reason: z.string().trim().min(1, 'Geef een reden bij een afwijzing').max(500),
  eventId: uuid.optional(),
});
export type DenyGuestRequestInput = z.input<typeof denyGuestRequestSchema>;
