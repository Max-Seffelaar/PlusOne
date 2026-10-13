/**
 * The field-error class tokens, in a module of their own so `places-field.tsx`
 * (which `kit.tsx` re-exports) can use them without a runtime import cycle.
 * Import them from the kit; this file is its implementation detail.
 */

// Canonical validation-error color (86eyd3men): red, never the lavender accent
// — the accent already means "focused"/"selected" elsewhere in the UI, so an
// invalid field styled in accent reads as active, not wrong. A dozen screens
// hand-rolled `text-red-300 role="alert"` locally before this existed; new
// inline-error UI should use these instead of re-picking a color.
export const fieldErrorText = 'text-red-300';
export const fieldErrorBorder = 'border-red-400';

// Clearance for the sticky top bar and the fixed bottom bar, safe-area aware
// (z8uq9m5eb7): where a browser aligns a scrolled-to field to an edge, it
// stops this far short of it.
export const fieldScrollMargin =
  'scroll-mt-[calc(env(safe-area-inset-top,0px)+88px)] scroll-mb-[calc(env(safe-area-inset-bottom,0px)+120px)]';
