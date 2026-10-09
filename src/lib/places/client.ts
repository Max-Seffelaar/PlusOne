// Browser side of the Places proxy (z8uq9m2vg5). Same-origin fetch only: no
// Google SDK, no popup, so it works the same in the Capacitor webview. Every
// failure resolves to "nothing to suggest"; the field it backs is always a
// plain, typeable text field first.

import type { PlaceAddress, PlaceSuggestion, PlacesRequest, PlacesResponse } from './schema';

/** Once the server says it has no key, stop asking for the rest of the page. */
let serverDisabled = false;

export function placesKnownDisabled(): boolean {
  return serverDisabled;
}

/** A Google session token: one per field focus, closed by one details call.
 *  crypto.randomUUID needs a secure context; the fallback covers old webviews. */
export function newPlacesSessionToken(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function call(body: PlacesRequest, signal?: AbortSignal): Promise<PlacesResponse | null> {
  if (serverDisabled) return { enabled: false };
  try {
    const res = await fetch('/api/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
    const json = (await res.json()) as PlacesResponse;
    if ('enabled' in json && json.enabled === false) serverDisabled = true;
    return json;
  } catch {
    return null;
  }
}

export async function fetchPlaceSuggestions(
  input: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const res = await call({ op: 'autocomplete', input, sessionToken }, signal);
  return res && 'ok' in res && res.ok && 'suggestions' in res ? res.suggestions : [];
}

export async function fetchPlaceAddress(placeId: string, sessionToken: string): Promise<PlaceAddress | null> {
  const res = await call({ op: 'details', placeId, sessionToken });
  return res && 'ok' in res && res.ok && 'place' in res ? res.place : null;
}
