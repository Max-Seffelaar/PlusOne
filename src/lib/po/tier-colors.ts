// Shared tier color palette (T3 — feedback 1/7: too few colors, duplicates
// allowed within an event). Single source of truth for events.tsx, templates.tsx
// and guests/_shared.tsx (previously three copies of the same 6-color array).
// Pastels chosen to stay legible against the near-black #0B0B0D background and
// to work with the door pill luminance guard (docs: door-pill-redesign memory).
export const TIER_COLORS = [
  '#B5A6FF', // lavender (brand accent)
  '#9DE0C0', // mint
  '#E8C98A', // sand
  '#9FB8E8', // sky blue
  '#E89AC0', // pink
  '#8E8E93', // grey
  '#E8A08A', // coral
  '#8AD4E8', // sky
  '#B8E89A', // sage
  '#CE9AE8', // orchid
  '#E8E09A', // gold
] as const;

/** First palette color not already used by another tier in the same event. */
export function nextAvailableColor(used: readonly string[]): string {
  return TIER_COLORS.find((c) => !used.includes(c)) ?? TIER_COLORS[0];
}

/** True once every palette color is already in use — reuse is then allowed (with a warning). */
export function allColorsUsed(used: readonly string[]): boolean {
  return TIER_COLORS.every((c) => used.includes(c));
}

/** Fallback tier color when a row carries none (mirrors the adapter default). */
export const DEFAULT_TIER_COLOR = '#B5A6FF';

/**
 * Pick readable ink for a solid tier-color fill. Tier colors are bright by
 * convention (the palette bets on dark text), but `color` is a user-editable
 * arbitrary hex, so guard a dark custom tier. Shared by the door check-in pills
 * and the Guests-list tier pills so both stay legible on any tier color.
 */
export function tierInk(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#0B0B0D';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.5 ? '#0B0B0D' : '#FFFFFF';
}

/** #RRGGBB → rgba(…, a) for a muted tint of a tier color over the near-black bg. */
export function tintTier(hex: string, a: number): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return `rgba(142, 142, 147, ${a})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
