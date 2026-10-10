// Places proxy contract (Onboarding A, z8uq9m2vg5; design: spike 9.6 in
// onboarding-orchestration-claude-code.md). Shared by the route and the
// browser client, so it holds no secret and imports nothing server-only.

import { z } from 'zod';

/** Autocomplete needs this many characters before we ask Google. */
export const PLACES_MIN_INPUT = 3;
export const PLACES_MAX_INPUT = 200;

const sessionToken = z.string().uuid();

/** One request shape per operation (Zod discriminated union on `op`). */
export const placesRequestSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('autocomplete'),
    input: z.string().trim().min(PLACES_MIN_INPUT).max(PLACES_MAX_INPUT),
    sessionToken,
  }),
  z.object({
    op: z.literal('details'),
    // Google place ids are URL-safe base64-ish; anything else never reaches the URL.
    placeId: z.string().regex(/^[A-Za-z0-9_-]{1,300}$/),
    sessionToken,
  }),
]);
export type PlacesRequest = z.infer<typeof placesRequestSchema>;

/** One autocomplete suggestion: the name and the rest of the line, as shown. */
export interface PlaceSuggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

/** The address of a picked place, in the fields venues already store. */
export interface PlaceAddress {
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2 ('NL'), like venues.country. */
  country: string | null;
  /** Google's one-line address, for single-field forms (wizard, event). */
  formattedAddress: string | null;
}

export type PlacesResponse =
  /** No Places key on the server: the field stays plain text. */
  | { enabled: false }
  | { ok: true; suggestions: PlaceSuggestion[] }
  | { ok: true; place: PlaceAddress }
  /** Throttled, invalid input or a Google error/timeout: nothing to show. */
  | { ok: false };
