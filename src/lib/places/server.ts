import 'server-only';

// Google Places API (New) calls for the proxy route (src/app/api/places).
// The key is server-only and referenced in this module alone (secret-grep
// guard in src/lib/supabase/service-confinement.test.ts); it is never a
// NEXT_PUBLIC_ value and never reaches the browser.
//
// Cost (spike 9.6): autocomplete + one details call per session token, and
// details asks only for Essentials fields (addressComponents,
// formattedAddress). displayName is a Pro field: the name comes from the
// suggestion the user picked, not from details.
//
// Logging: status codes and error names only. Never the input text (it can be
// a home address = PII) and never the key.

import type { PlaceAddress, PlaceSuggestion } from './schema';

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_URL = 'https://places.googleapis.com/v1/places/';
const TIMEOUT_MS = 3000;
/** Product decision (spike 9.6): our venues are in these countries. */
const REGION_CODES = ['nl', 'be', 'de'];

export function placesApiKey(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY || null;
}

type Fetch = typeof fetch;

interface AutocompleteBody {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    };
  }>;
}

interface DetailsBody {
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
}

export async function placesAutocomplete(
  key: string,
  input: string,
  sessionToken: string,
  fetchFn: Fetch = fetch,
): Promise<PlaceSuggestion[] | null> {
  try {
    const res = await fetchFn(AUTOCOMPLETE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
      },
      body: JSON.stringify({ input, sessionToken, languageCode: 'en', includedRegionCodes: REGION_CODES }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error('places: autocomplete failed', { status: res.status });
      return null;
    }
    const body = (await res.json()) as AutocompleteBody;
    const out: PlaceSuggestion[] = [];
    for (const s of body.suggestions ?? []) {
      const p = s.placePrediction;
      if (!p?.placeId) continue;
      out.push({
        placeId: p.placeId,
        mainText: p.structuredFormat?.mainText?.text ?? '',
        secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
      });
    }
    return out;
  } catch (err) {
    console.error('places: autocomplete threw', { error: err instanceof Error ? err.name : 'unknown' });
    return null;
  }
}

export async function placesDetails(
  key: string,
  placeId: string,
  sessionToken: string,
  fetchFn: Fetch = fetch,
): Promise<PlaceAddress | null> {
  try {
    const q = new URLSearchParams({ sessionToken, languageCode: 'en' });
    const res = await fetchFn(`${DETAILS_URL}${encodeURIComponent(placeId)}?${q.toString()}`, {
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'addressComponents,formattedAddress',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error('places: details failed', { status: res.status });
      return null;
    }
    return mapAddress((await res.json()) as DetailsBody);
  } catch (err) {
    console.error('places: details threw', { error: err instanceof Error ? err.name : 'unknown' });
    return null;
  }
}

/** addressComponents → the venues fields. NL/BE/DE write the street first,
 *  then the number ("Wibautstraat 150"). */
export function mapAddress(body: DetailsBody): PlaceAddress {
  const comps = body.addressComponents ?? [];
  const find = (type: string) => comps.find((c) => c.types?.includes(type));
  const street = find('route')?.longText ?? '';
  const number = find('street_number')?.longText ?? '';
  const line = [street, number].filter(Boolean).join(' ').trim();
  const country = find('country')?.shortText ?? null;
  return {
    addressLine: line || null,
    postalCode: find('postal_code')?.longText ?? null,
    city: find('locality')?.longText ?? find('postal_town')?.longText ?? null,
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    formattedAddress: body.formattedAddress ?? null,
  };
}
