/**
 * Ranged paging for PostgREST reads.
 *
 * PostgREST caps EVERY response at `max-rows` (1000 by default on Supabase), and
 * the cap applies to RPCs too — a server function does NOT escape it. So any
 * event-wide read that can exceed 1000 rows (guests/check_ins/refusals at a busy
 * 1500-guest door) must page with `.range(from, to)` or it silently truncates and
 * the door can't see ~532 guests.
 *
 * Supabase query builders are one-shot thenables: awaiting one consumes it, so a
 * second `.range()` on the same builder won't re-issue the request. We therefore
 * take a PAGE FACTORY that returns a FRESH builder per page and loop until a page
 * comes back short (< pageSize), which means we've reached the end.
 *
 * CRITICAL: ranged paging is only correct over a DETERMINISTIC total order. If the
 * order isn't unique, rows can shift between page requests and overlap or be
 * skipped. Every caller must give the page a stable, fully-ordered sort (append a
 * unique tiebreaker like `.order('id')` to whatever primary order it already has).
 */

/** PostgREST's default `max-rows`; one ranged page asks for exactly this many. */
export const PAGE_SIZE = 1000;

/** Safety cap so a mis-ordered (never-short) page set can't loop forever. */
export const MAX_PAGES = 50;

/** The shape of a resolved PostgREST query (`data` + `error`), order-agnostic. */
type PageResult<T> = { data: T[] | null; error: unknown };

/**
 * Run `makePage` once per `.range()` window and concatenate every row.
 *
 * @param makePage  Builds a FRESH, deterministically-ordered query for the
 *                  inclusive row window `[from, to]`. Typically:
 *                  `(from, to) => client.from('guests').select('…')
 *                     .eq('event_id', id).order('created_at').order('id')
 *                     .range(from, to)`
 * @param pageSize  Rows per page (defaults to PostgREST's max-rows). A page that
 *                  returns fewer than this is the last page.
 * @param maxPages  Hard stop against runaway loops (defaults to MAX_PAGES).
 * @throws if any page returns an `error` (we never silently truncate), or if the
 *         page count would exceed `maxPages`.
 */
export async function fetchAllRanged<T>(
  makePage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
  maxPages = MAX_PAGES,
): Promise<T[]> {
  const all: T[] = [];

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await makePage(from, to);
    if (error) throw error;

    const rows = data ?? [];
    all.push(...rows);

    // A short (or empty) page means there's nothing after it — we're done.
    if (rows.length < pageSize) return all;
  }

  // Reached the page cap while every page was still full: the order is almost
  // certainly non-deterministic (or the dataset is implausibly large). Fail loud
  // rather than return a partial-but-plausible result.
  throw new Error(
    `fetchAllRanged: exceeded maxPages (${maxPages}) at pageSize ${pageSize} — ` +
      'the page query is likely missing a deterministic total order (unique tiebreaker).',
  );
}

/**
 * Split `ids` into chunks no larger than `size`. Use this to keep `.in('x', ids)`
 * filters under both PostgREST's max-rows AND Kong's URI length — a 1500-id `.in()`
 * can blow the URL limit and still over-return. Each chunk is then queried (and,
 * if the chunk itself can yield >1000 rows, ranged) separately.
 */
export function chunkIds<T>(ids: readonly T[], size = PAGE_SIZE): T[][] {
  if (size < 1) throw new Error('chunkIds: size must be >= 1');
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}
