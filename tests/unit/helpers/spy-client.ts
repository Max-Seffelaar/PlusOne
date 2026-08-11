/**
 * A minimal chainable Supabase query-builder spy, one config per `.from()`
 * table name. Every chain method (`select`/`eq`/`neq`/`in`/`is`/`order`/
 * `range`/`limit`) returns `this` and is recorded (tagged with the table it
 * was called on), so a test can assert exactly which filter a fetcher issued
 * — including asserting a call was NEVER made (e.g. no `.eq('guests.event_id',
 * …)` after a fetcher is rewritten to filter a denormalized column directly).
 * Thenable, so both a bare `await query` and `fetchAllRanged`'s
 * `await makePage(...)` resolve without a terminal method; `.single()`/
 * `.maybeSingle()` resolve immediately instead of being chainable.
 *
 * Originated in the SCALE-5 guard (single-table) and generalized here to
 * cover multi-table reads in one client, like `fetchDoorSnapshot`.
 */
import { vi } from 'vitest';

export interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

export interface SpyTableConfig {
  /** Rows returned for a non-terminal (thenable) read. Defaults to []. */
  data?: unknown;
  /** Error returned instead of/alongside data. Defaults to null. */
  error?: unknown;
}

export interface SpyClient {
  from: (table: string) => unknown;
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
}

export function createSpyClient(
  tables: Record<string, SpyTableConfig>,
  opts: { userId?: string | null } = {},
): { client: SpyClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  function makeChain(table: string, config: SpyTableConfig) {
    const chain: Record<string, unknown> = {};
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    for (const method of ['select', 'eq', 'neq', 'in', 'is', 'order', 'range', 'limit']) {
      chain[method] = record(method);
    }
    const resolved = () => Promise.resolve({ data: config.data ?? null, error: config.error ?? null });
    chain.single = () => {
      calls.push({ table, method: 'single', args: [] });
      return resolved();
    };
    chain.maybeSingle = () => {
      calls.push({ table, method: 'maybeSingle', args: [] });
      return resolved();
    };
    chain.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
      resolve({ data: config.data ?? [], error: config.error ?? null });
    return chain;
  }

  const from = vi.fn((table: string) => {
    const config = tables[table];
    if (!config) throw new Error(`createSpyClient: no config registered for table "${table}"`);
    return makeChain(table, config);
  });

  const client: SpyClient = {
    from,
    auth: { getUser: async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }) },
  };

  return { client, calls };
}
