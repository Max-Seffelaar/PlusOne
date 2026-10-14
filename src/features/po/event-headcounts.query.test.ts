/**
 * fetchEventHeadcounts' scope (Snelheid P2 review, #484 ↔ #490): the scope
 * object and the older positional `sinceIso` string must both keep their
 * window, so callers written against either signature work in any merge order.
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchEventHeadcounts } from './queries';

function client() {
  const rpc = vi.fn(async () => ({ data: [], error: null }));
  return { c: { rpc } as never, rpc };
}

describe('fetchEventHeadcounts scope', () => {
  it('no scope: the whole venue', async () => {
    const { c, rpc } = client();
    await fetchEventHeadcounts(c, 'v1');
    expect(rpc).toHaveBeenCalledWith('venue_event_headcounts', { p_venue_id: 'v1' });
  });

  it('a positional string is still the since-window, never dropped', async () => {
    const { c, rpc } = client();
    await fetchEventHeadcounts(c, 'v1', '2026-10-01T00:00:00Z');
    expect(rpc).toHaveBeenCalledWith('venue_event_headcounts', { p_venue_id: 'v1', p_since: '2026-10-01T00:00:00Z' });
  });

  it('the scope object passes since and/or one event', async () => {
    const { c, rpc } = client();
    await fetchEventHeadcounts(c, 'v1', { sinceIso: '2026-10-01T00:00:00Z' });
    await fetchEventHeadcounts(c, 'v1', { eventId: 'e1' });
    expect(rpc).toHaveBeenNthCalledWith(1, 'venue_event_headcounts', { p_venue_id: 'v1', p_since: '2026-10-01T00:00:00Z' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'venue_event_headcounts', { p_venue_id: 'v1', p_event_id: 'e1' });
  });
});
