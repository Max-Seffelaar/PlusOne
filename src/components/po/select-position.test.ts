import { describe, it, expect } from 'vitest';
import { popoverPlacement, POPOVER_GAP } from './select-position';

const VP = { width: 1280, height: 800 };
const trigger = (top: number, left = 40, width = 300) => ({ top, bottom: top + 50, left, width });

describe('popoverPlacement (z8uq9m5m8h)', () => {
  it('opens under the trigger when the list fits', () => {
    const p = popoverPlacement(trigger(100), VP, 200);
    expect(p).toMatchObject({ above: false, top: 150 + POPOVER_GAP, left: 40, width: 300, maxHeight: 320 });
    expect(p.bottom).toBeUndefined();
  });

  it('flips above when there is no room below and more above, anchored by the bottom edge', () => {
    const p = popoverPlacement(trigger(650), VP, 300);
    expect(p.above).toBe(true);
    expect(p.bottom).toBe(800 - 650 + POPOVER_GAP);
    expect(p.top).toBeUndefined();
    expect(p.maxHeight).toBe(320);
  });

  it('stays below when the room above is smaller, and caps the height to the room below', () => {
    const p = popoverPlacement({ top: 60, bottom: 700, left: 0, width: 300 }, VP, 320);
    expect(p.above).toBe(false);
    expect(p.maxHeight).toBe(800 - 700 - POPOVER_GAP - 8);
  });

  it('a short list near the bottom that still fits stays below', () => {
    expect(popoverPlacement(trigger(650), VP, 60).above).toBe(false);
  });

  it('keeps at least 220px wide and inside the window on the right', () => {
    const p = popoverPlacement(trigger(100, 1200, 120), VP, 100);
    expect(p.width).toBe(220);
    expect(p.left).toBe(1280 - 220 - 8);
  });
});
