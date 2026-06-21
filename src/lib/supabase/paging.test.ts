import { describe, expect, it } from 'vitest';
import { chunkIds, fetchAllRanged, MAX_PAGES, PAGE_SIZE } from './paging';

type Row = { id: number };

/**
 * A fake PostgREST-style page factory backed by an in-memory array. It records
 * every (from, to) window it was asked for and slices the array exactly the way
 * `.range()` does (inclusive bounds). No network, no DB.
 */
function fakePages(total: number) {
  const rows: Row[] = Array.from({ length: total }, (_, i) => ({ id: i }));
  const ranges: Array<[number, number]> = [];
  let calls = 0;

  const makePage = (from: number, to: number) => {
    calls++;
    ranges.push([from, to]);
    // `.range(from, to)` is inclusive on both ends.
    const slice = rows.slice(from, to + 1);
    return Promise.resolve({ data: slice, error: null });
  };

  return {
    makePage,
    ranges,
    get calls() {
      return calls;
    },
  };
}

describe('fetchAllRanged', () => {
  it('pages a 2500-row set across 3 calls and returns every row', async () => {
    const fake = fakePages(2500);
    const result = await fetchAllRanged<Row>(fake.makePage);

    expect(result).toHaveLength(2500);
    expect(result.map((r) => r.id)).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    // 1000 + 1000 + 500 → the third page is short, so the loop stops.
    expect(fake.calls).toBe(3);
    expect(fake.ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('uses a single call for a sub-page result (30 rows)', async () => {
    const fake = fakePages(30);
    const result = await fetchAllRanged<Row>(fake.makePage);

    expect(result).toHaveLength(30);
    expect(fake.calls).toBe(1);
    expect(fake.ranges).toEqual([[0, 999]]);
  });

  it('needs a second (empty) call when the total is exactly one page', async () => {
    const fake = fakePages(PAGE_SIZE); // exactly 1000
    const result = await fetchAllRanged<Row>(fake.makePage);

    expect(result).toHaveLength(PAGE_SIZE);
    // First page is FULL (1000), so the loop can't know it's the end → asks again,
    // gets an empty page, then stops.
    expect(fake.calls).toBe(2);
    expect(fake.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('returns [] for an empty table in a single call', async () => {
    const fake = fakePages(0);
    const result = await fetchAllRanged<Row>(fake.makePage);

    expect(result).toEqual([]);
    expect(fake.calls).toBe(1);
    expect(fake.ranges).toEqual([[0, 999]]);
  });

  it('treats a null data page as empty (and stops)', async () => {
    let calls = 0;
    const result = await fetchAllRanged<Row>(() => {
      calls++;
      return Promise.resolve({ data: null, error: null });
    });

    expect(result).toEqual([]);
    expect(calls).toBe(1);
  });

  it('throws when a page reports an error (never silently truncates)', async () => {
    const boom = { message: 'permission denied' };
    let calls = 0;
    await expect(
      fetchAllRanged<Row>((from) => {
        calls++;
        // First page ok (full), second page errors.
        if (from === 0) {
          return Promise.resolve({ data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i })), error: null });
        }
        return Promise.resolve({ data: null, error: boom });
      }),
    ).rejects.toBe(boom);
    expect(calls).toBe(2);
  });

  it('honours a custom pageSize for the range windows', async () => {
    const fake = fakePages(250);
    const result = await fetchAllRanged<Row>(fake.makePage, 100);

    expect(result).toHaveLength(250);
    expect(fake.calls).toBe(3); // 100 + 100 + 50
    expect(fake.ranges).toEqual([
      [0, 99],
      [100, 199],
      [200, 299],
    ]);
  });

  it('STOPS instead of looping forever when pages never go short', async () => {
    // A pathological factory that always returns a FULL page (simulating a
    // non-deterministic order that overlaps), so the short-page exit never fires.
    let calls = 0;
    const alwaysFull = () => {
      calls++;
      return Promise.resolve({
        data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i })),
        error: null,
      });
    };

    await expect(fetchAllRanged<Row>(alwaysFull)).rejects.toThrow(/exceeded maxPages/);
    // It must have hit the cap exactly, not spun beyond it.
    expect(calls).toBe(MAX_PAGES);
  });

  it('respects a custom maxPages cap', async () => {
    let calls = 0;
    const alwaysFull = () => {
      calls++;
      return Promise.resolve({
        data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i })),
        error: null,
      });
    };

    await expect(fetchAllRanged<Row>(alwaysFull, PAGE_SIZE, 3)).rejects.toThrow(/exceeded maxPages \(3\)/);
    expect(calls).toBe(3);
  });
});

describe('chunkIds', () => {
  it('returns no chunks for an empty list', () => {
    expect(chunkIds([])).toEqual([]);
  });

  it('keeps a sub-size list as a single chunk', () => {
    expect(chunkIds([1, 2, 3], 1000)).toEqual([[1, 2, 3]]);
  });

  it('splits a 2500-id list into 1000/1000/500', () => {
    const ids = Array.from({ length: 2500 }, (_, i) => i);
    const chunks = chunkIds(ids);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(1000);
    expect(chunks[1]).toHaveLength(1000);
    expect(chunks[2]).toHaveLength(500);
    // Round-trips back to the original, in order.
    expect(chunks.flat()).toEqual(ids);
  });

  it('honours a custom chunk size', () => {
    expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('throws on a non-positive size', () => {
    expect(() => chunkIds([1, 2], 0)).toThrow();
  });
});
