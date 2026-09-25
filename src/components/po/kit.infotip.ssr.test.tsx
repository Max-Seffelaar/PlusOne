// @vitest-environment node
/**
 * InfoTip picks popover vs sheet on the pointer (hover-capable fine pointer →
 * anchored popover, touch → bottom sheet). That choice must live in CSS media
 * queries only, never in a render-time `window`/`matchMedia` read: the server
 * has no window, and a JS branch would render different markup on the server
 * and on a touch client (hydration mismatch). This file runs without a DOM to
 * prove the server render needs none; the hydration half is in
 * `kit.infotip.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { InfoTip } from './kit';

describe('InfoTip server render', () => {
  it('renders with no window or document', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    const html = renderToString(<InfoTip label="What this does" title="What this does" body="Body" closeLabel="Got it" />);
    expect(html).toContain('aria-label="What this does"');
    expect(html).toContain('aria-expanded="false"');
  });
});
