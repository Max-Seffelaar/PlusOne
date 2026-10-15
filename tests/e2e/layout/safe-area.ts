import type { BrowserContext, Page } from '@playwright/test';

/**
 * Simulated system bars for the touch projects (CLAUDE.md "Design & surface",
 * design-system.md "Safe area"). The app draws edge-to-edge, so on a real
 * phone the status bar / notch sit over the top of the page and the Android
 * navigation bar (or the iOS home indicator) over the bottom. Every inset the
 * app reads goes through the `--safe-*` tokens in globals.css, which take
 * Capacitor's injected `--safe-area-inset-*` first — so setting those four
 * properties on <html> here is exactly what the Android shell does on device.
 *
 * Sizes are the worst common case: a 48px status bar with a camera cutout and
 * the 48px Android 3-button navigation bar (taller than the iOS home
 * indicator, 34px).
 */
export const SIM_INSETS = { top: 48, right: 0, bottom: 48, left: 0 } as const;

const script = (insets: typeof SIM_INSETS): void => {
  const apply = (): void => {
    const s = document.documentElement.style;
    s.setProperty('--safe-area-inset-top', `${insets.top}px`);
    s.setProperty('--safe-area-inset-right', `${insets.right}px`);
    s.setProperty('--safe-area-inset-bottom', `${insets.bottom}px`);
    s.setProperty('--safe-area-inset-left', `${insets.left}px`);
  };
  if (document.documentElement) apply();
  else document.addEventListener('DOMContentLoaded', apply, { once: true });
};

/** Every page of the context starts with the simulated insets. */
export async function simulateSystemBars(context: BrowserContext): Promise<void> {
  await context.addInitScript(script, SIM_INSETS);
}

/**
 * Visible text and controls that sit under a simulated system bar. The bars
 * are drawn over the page, so anything readable or tappable in the top
 * `insets.top` px or the bottom `insets.bottom` px is covered on a phone.
 *
 * Counted: controls (button, link, field, role=button/tab/link/switch) and any
 * element with its own non-blank text. Backgrounds, borders and empty
 * decoration may (and should) run under the bars. Content inside a scroller
 * that can still scroll it out of the band is fine: that is ordinary
 * scrolling, and at rest the screen's own padding keeps the last row clear.
 */
export async function underSystemBars(page: Page): Promise<string[]> {
  return page.evaluate((insets) => {
    const vh = window.innerHeight;
    const top = insets.top;
    const bottom = vh - insets.bottom;
    const CONTROL = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=link], [role=switch]';

    const ownText = (el: Element): boolean =>
      Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');

    const visible = (el: Element, r: DOMRect): boolean => {
      if (r.width <= 1 || r.height <= 1) return false;
      if (r.bottom <= 0 || r.top >= vh) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      if (el.closest('[inert], [aria-hidden="true"]')) return false;
      return true;
    };

    /** Px the nearest scroll container can still move `el` up / down. */
    const scrollRoom = (el: Element): { down: number; up: number } => {
      let down = 0;
      let up = 0;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) {
          down += p.scrollHeight - p.clientHeight - p.scrollTop;
          up += p.scrollTop;
        }
      }
      const doc = document.scrollingElement;
      if (doc) {
        down += Math.max(0, doc.scrollHeight - doc.clientHeight - doc.scrollTop);
        up += doc.scrollTop;
      }
      return { down, up };
    };

    const describe = (el: Element, r: DOMRect, where: string): string => {
      const tag = el.tagName.toLowerCase();
      const label =
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        (el as HTMLElement).innerText?.trim().replace(/\s+/g, ' ').slice(0, 40) ||
        '';
      const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 5).join('.');
      return `${where} ${Math.round(r.top)}–${Math.round(r.bottom)}px <${tag}${cls ? `.${cls}` : ''}>${label ? ` "${label}"` : ''}`;
    };

    const out: string[] = [];
    const flagged: Element[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (!el.matches(CONTROL) && !ownText(el)) continue;
      const r = el.getBoundingClientRect();
      if (!visible(el, r)) continue;
      const inTop = r.top < top - 0.5;
      const inBottom = r.bottom > bottom + 0.5;
      if (!inTop && !inBottom) continue;
      if (flagged.some((f) => f.contains(el))) continue; // outermost only
      const room = scrollRoom(el);
      if (inBottom && room.down >= r.bottom - bottom) continue;
      if (inTop && room.up >= top - r.top) continue;
      flagged.push(el);
      out.push(describe(el, r, inTop ? 'under the status bar' : 'under the navigation bar'));
    }
    return out;
  }, SIM_INSETS);
}
