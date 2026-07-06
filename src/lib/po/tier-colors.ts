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
