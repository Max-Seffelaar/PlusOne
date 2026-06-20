// Duplicate handling for "Plak namen" (bulk add to a gastenlijst): some pasted
// people may already be on the list. We match best-effort on the normalized name
// — the user confirms via a 3-way choice, so a false positive is recoverable with
// "toch opnieuw toevoegen". Pure + unit-tested; the screen owns the I/O.

export interface ExistingGuest {
  id: string;
  name: string;
  plusOnes: number;
}

export interface BulkRowInput {
  name: string;
  plusOnes: number;
  tierId: string;
  email?: string;
  phone?: string;
}

/** What to do with rows that match someone already on the list. */
export type DupeMode = 'add' | 'replace' | 'again';

const norm = (s: string): string => s.trim().toLowerCase();

/** Index existing guests by normalized name (first occurrence wins on collisions). */
export function indexGuestsByName(existing: ExistingGuest[]): Map<string, ExistingGuest> {
  const m = new Map<string, ExistingGuest>();
  for (const g of existing) {
    const k = norm(g.name);
    if (k && !m.has(k)) m.set(k, g);
  }
  return m;
}

/** Distinct display names from `rows` that match an existing guest (the
 *  "wij denken dat deze er al op staan" list). */
export function suspectedDuplicates(rows: BulkRowInput[], byName: Map<string, ExistingGuest>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const k = norm(r.name);
    if (k && byName.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(r.name.trim());
    }
  }
  return out;
}

export interface BulkPlan {
  /** Rows to insert as brand-new guests (non-dupes + every 'again' dupe). */
  inserts: BulkRowInput[];
  /** Existing guests whose plus-ones change ('replace' / 'add'). */
  updates: { guestId: string; plusOnes: number }[];
  /** How many rows matched an existing guest. */
  dupeCount: number;
}

/**
 * Split parsed rows into inserts + plus-ones updates, per the chosen duplicate
 * mode. 'again' inserts the dupe as a fresh guest; 'replace' sets the existing
 * guest's plus-ones to the row value; 'add' adds the row's plus-ones on top.
 * Several rows hitting one existing guest accumulate (for 'add') / last-wins (for
 * 'replace').
 */
export function planBulkAdd(
  rows: BulkRowInput[],
  byName: Map<string, ExistingGuest>,
  mode: DupeMode
): BulkPlan {
  const inserts: BulkRowInput[] = [];
  const updateMap = new Map<string, number>();
  let dupeCount = 0;
  for (const r of rows) {
    const existing = byName.get(norm(r.name));
    if (!existing) {
      inserts.push(r);
      continue;
    }
    dupeCount++;
    if (mode === 'again') {
      inserts.push(r);
      continue;
    }
    if (mode === 'replace') {
      updateMap.set(existing.id, r.plusOnes);
    } else {
      const base = updateMap.has(existing.id) ? (updateMap.get(existing.id) as number) : existing.plusOnes;
      updateMap.set(existing.id, base + r.plusOnes);
    }
  }
  const updates = [...updateMap].map(([guestId, plusOnes]) => ({ guestId, plusOnes }));
  return { inserts, updates, dupeCount };
}
