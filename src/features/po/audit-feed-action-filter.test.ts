/**
 * The audit filter sheet's action chips can group actions ("List lock" =
 * lock + unlock, "Privacy" = anonymize + export): fetchPoAuditFeed must send
 * the chip's whole action list to the database, and no action filter for "All".
 */
import { describe, it, expect, vi } from 'vitest';
import { fetchPoAuditFeed } from './queries';

function client() {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'or']) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    });
  }
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  const rpc = vi.fn(() => Promise.resolve({ data: [], error: null }));
  return { client: { from: vi.fn(() => chain), rpc } as never, calls };
}

const actionFilters = (calls: { method: string; args: unknown[] }[]) =>
  calls.filter((c) => (c.method === 'in' || c.method === 'eq') && c.args[0] === 'action');

describe('fetchPoAuditFeed action filter', () => {
  it('sends a grouped chip as one IN list', async () => {
    const { client: c, calls } = client();
    await fetchPoAuditFeed(c, { venueId: 'v1', action: 'lock' });
    expect(actionFilters(calls)).toEqual([{ method: 'in', args: ['action', ['lock', 'unlock']] }]);
  });

  it('the Privacy chip matches anonymize and export', async () => {
    const { client: c, calls } = client();
    await fetchPoAuditFeed(c, { venueId: 'v1', action: 'privacy' });
    expect(actionFilters(calls)).toEqual([{ method: 'in', args: ['action', ['anonymize', 'export']] }]);
  });

  it('"all" adds no action filter', async () => {
    const { client: c, calls } = client();
    await fetchPoAuditFeed(c, { venueId: 'v1', action: 'all' });
    expect(actionFilters(calls)).toEqual([]);
  });
});
