import { z } from 'zod';
import { EMAIL_RE } from './validation';

const uuid = z.string().uuid();

/** Missing-contact messages (86eyke279). Shared by the "absent", "empty string"
 *  and "whitespace only" cases so all three read identically to the requester —
 *  the field is missing, the shape is not the complaint. */
const EMAIL_REQUIRED = 'Enter your email address';
const PHONE_REQUIRED = 'Enter your phone number';

/** Trimmed free text that treats an empty string as "not provided". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

/**
 * Public landing-page submission (#12). Name, e-mail AND phone are all
 * required (86eyke279, 2026-08-19 — narrows #9's "never mandatory" for THIS
 * path only: a venue that approves a guest must be able to reach them). The
 * rest stays optional. Enforced again inside the SECURITY DEFINER
 * `submit_guest_request` RPC (migration 20260819110000) — this schema only
 * guards the app path, the RPC guards the raw anon call. `company` is a
 * honeypot — a hidden field real users leave empty; the server action drops
 * the request silently when it is filled.
 */
export const submitGuestRequestSchema = z.object({
  // The slug comes from the route, not user input, but we still validate shape.
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/i, 'Invalid link'),
  fullName: z.string().trim().min(2, 'Enter your name').max(120),
  // Same shape check as the form's inline `isValidEmail` (validation.ts) — a
  // request that passes client-side never gets silently rejected here.
  // Required (86eyke279). `.trim()` runs before `.min(1)` in Zod's ordered
  // check list, so '   ' collapses to '' and fails "required" rather than
  // sneaking through as a non-empty string; a non-string (null included) is
  // already rejected by `z.string()` itself.
  email: z
    .string({ required_error: EMAIL_REQUIRED, invalid_type_error: EMAIL_REQUIRED })
    .trim()
    .min(1, EMAIL_REQUIRED)
    .max(254)
    .regex(EMAIL_RE, 'Invalid email'),
  // Phone arrives already normalised to E.164 by the form (libphonenumber); it
  // must carry a country code or it is useless to the venue. Canonical E.164
  // shape (+ then up to 15 digits) so no valid international number is
  // rejected. Required since 86eyke279, same empty-value handling as e-mail.
  phone: z
    .string({ required_error: PHONE_REQUIRED, invalid_type_error: PHONE_REQUIRED })
    .trim()
    .min(1, PHONE_REQUIRED)
    .regex(/^\+[1-9]\d{1,14}$/, 'Invalid phone number'),
  plusOnes: z.coerce.number().int().min(0).max(20).default(0),
  motivation: optionalText(1000),
  // Optional birthdate (#8) — captured into the venue address book. ISO date.
  birthdate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date of birth')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Marketing consent (AVG) — opt-in, defaults to false.
  marketingOptIn: z.boolean().optional().default(false),
  // Honeypot — must stay empty. Anything here means "bot".
  company: z.string().max(200).optional(),
  // Cloudflare Turnstile response token (86ey2czr6). Absent whenever the
  // widget didn't render (no NEXT_PUBLIC_TURNSTILE_SITE_KEY configured) —
  // verifyTurnstileToken treats that the same as a keyless server.
  turnstileToken: z.string().max(2048).optional(),
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
  reason: z.string().trim().min(1, 'Give a reason for declining').max(500),
  eventId: uuid.optional(),
});
export type DenyGuestRequestInput = z.input<typeof denyGuestRequestSchema>;

/**
 * Result shape of the `submit_guest_request` RPC (jsonb — see
 * 20260706103000_submit_via_request_link.sql): every `return
 * jsonb_build_object(...)` in that function sets `status`, so it's required
 * here, not optional — an object without it is exactly the "unexpected
 * shape" this schema exists to catch. `auto_approved` is display-only (the
 * caller only ever checks `=== true`), so a non-boolean there shouldn't veto
 * an otherwise-real `status: 'ok'` success; `z.unknown()` lets the `=== true`
 * check fail open instead. Validated rather than hand-cast so a mismatched
 * deploy (app ahead of/behind the DB function) fails closed instead of
 * silently reading `undefined` off an unexpected shape.
 */
export const submitGuestRequestResultSchema = z.object({
  status: z.enum(['ok', 'rate_limited', 'closed', 'invalid']),
  auto_approved: z.unknown().optional(),
});
