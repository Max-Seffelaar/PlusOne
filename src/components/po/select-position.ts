/**
 * Where the kit Select's fine-pointer popover goes (z8uq9m5m8h). The popover is
 * portalled to `document.body` and `position: fixed`, so a scrolling Sheet or an
 * `overflow: hidden` table cell can never clip it; this places it from the
 * trigger's viewport rect instead of from its parent.
 *
 * Under the trigger by default. Flipped above only when the list does not fit
 * below AND there is more room above (a field near the bottom of the window).
 * Above, the panel is anchored by its `bottom`, so a list shorter than the
 * estimate still hugs the trigger. The height is capped to the room on the side it opens on.
 */

export interface TriggerRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface PopoverPlacement {
  /** Viewport px from the top (opening down) … */
  top?: number;
  /** … or from the bottom (opening up). Exactly one of the two is set. */
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  above: boolean;
}

/** Gap between trigger and panel (the old `top-[calc(100%+6px)]`). */
export const POPOVER_GAP = 6;
/** Keep this much air to the window edge. */
export const POPOVER_MARGIN = 8;
/** The panel's cap, as before (`max-h-[320px]`). */
export const POPOVER_MAX_HEIGHT = 320;
const MIN_WIDTH = 220;

export function popoverPlacement(
  trigger: TriggerRect,
  viewport: { width: number; height: number },
  /** The height the list wants (rows + padding), capped at POPOVER_MAX_HEIGHT. */
  wanted: number,
): PopoverPlacement {
  const want = Math.min(POPOVER_MAX_HEIGHT, wanted);
  const below = viewport.height - trigger.bottom - POPOVER_GAP - POPOVER_MARGIN;
  const aboveRoom = trigger.top - POPOVER_GAP - POPOVER_MARGIN;
  const above = below < want && aboveRoom > below;
  const width = Math.min(Math.max(trigger.width, MIN_WIDTH), viewport.width - 2 * POPOVER_MARGIN);
  const left = Math.max(POPOVER_MARGIN, Math.min(trigger.left, viewport.width - width - POPOVER_MARGIN));
  const maxHeight = Math.max(0, Math.min(POPOVER_MAX_HEIGHT, above ? aboveRoom : below));
  return above
    ? { bottom: viewport.height - trigger.top + POPOVER_GAP, left, width, maxHeight, above }
    : { top: trigger.bottom + POPOVER_GAP, left, width, maxHeight, above };
}
