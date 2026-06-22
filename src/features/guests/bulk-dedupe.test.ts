import { describe, expect, it } from 'vitest';
import {
  indexGuestsByName,
  suspectedDuplicates,
  planBulkAdd,
  type BulkRowInput,
  type ExistingGuest,
} from './bulk-dedupe';

const existing: ExistingGuest[] = [
  { id: 'g1', name: 'Anouk Smit', plusOnes: 2 },
  { id: 'g2', name: 'Pim Scholten', plusOnes: 0 },
];
const byName = indexGuestsByName(existing);

const row = (name: string, plusOnes = 0): BulkRowInput => ({ name, plusOnes, tierId: 't1' });

describe('indexGuestsByName', () => {
  it('normalizes the name key and keeps the first on collision', () => {
    const m = indexGuestsByName([
      { id: 'a', name: '  Anouk Smit ', plusOnes: 1 },
      { id: 'b', name: 'ANOUK SMIT', plusOnes: 9 },
    ]);
    expect(m.get('anouk smit')?.id).toBe('a');
  });
});

describe('suspectedDuplicates', () => {
  it('lists distinct pasted names that match an existing guest (case/space-insensitive)', () => {
    const dupes = suspectedDuplicates(
      [row(' anouk smit '), row('Nieuwe Naam'), row('PIM SCHOLTEN'), row('anouk smit')],
      byName
    );
    expect(dupes).toEqual(['anouk smit', 'PIM SCHOLTEN']);
  });
  it('returns nothing when no row matches', () => {
    expect(suspectedDuplicates([row('Jan'), row('Klaas')], byName)).toEqual([]);
  });
});

describe('planBulkAdd', () => {
  const rows = [row('Anouk Smit', 1), row('Nieuwe Naam', 3), row('Pim Scholten', 2)];

  it("mode 'add' increments the existing plus-ones and inserts only the new row", () => {
    const plan = planBulkAdd(rows, byName, 'add');
    expect(plan.dupeCount).toBe(2);
    expect(plan.inserts.map((r) => r.name)).toEqual(['Nieuwe Naam']);
    expect(plan.updates).toEqual([
      { guestId: 'g1', plusOnes: 3 }, // 2 existing + 1
      { guestId: 'g2', plusOnes: 2 }, // 0 existing + 2
    ]);
  });

  it("mode 'replace' sets the existing plus-ones to the row value", () => {
    const plan = planBulkAdd(rows, byName, 'replace');
    expect(plan.inserts.map((r) => r.name)).toEqual(['Nieuwe Naam']);
    expect(plan.updates).toEqual([
      { guestId: 'g1', plusOnes: 1 },
      { guestId: 'g2', plusOnes: 2 },
    ]);
  });

  it("mode 'again' inserts every row as new and updates nothing", () => {
    const plan = planBulkAdd(rows, byName, 'again');
    expect(plan.updates).toEqual([]);
    expect(plan.inserts.map((r) => r.name)).toEqual(['Anouk Smit', 'Nieuwe Naam', 'Pim Scholten']);
    expect(plan.dupeCount).toBe(2);
  });

  it("accumulates when several pasted rows hit the same existing guest (mode 'add')", () => {
    const plan = planBulkAdd([row('Anouk Smit', 1), row('anouk smit', 2)], byName, 'add');
    expect(plan.updates).toEqual([{ guestId: 'g1', plusOnes: 5 }]); // 2 + 1 + 2
    expect(plan.inserts).toEqual([]);
  });
});

// Quick-add (S2.2) reuses the same planner with a SINGLE row, so the one-name
// flow is just these single-row cases. The screen detects a dupe via the same
// byName index (lookup on the normalized typed name) and only then offers the
// 3-choice; these assertions pin the insert-vs-update split per choice.
describe('quick-add single-row planning', () => {
  it('no match → one insert, no update (plain add)', () => {
    const plan = planBulkAdd([row('Nieuwe Gast', 2)], byName, 'again');
    expect(plan.dupeCount).toBe(0);
    expect(plan.inserts.map((r) => r.name)).toEqual(['Nieuwe Gast']);
    expect(plan.updates).toEqual([]);
  });

  it("dupe + 'add' → update only, plekken on top of the existing count", () => {
    const plan = planBulkAdd([row('Anouk Smit', 1)], byName, 'add');
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([{ guestId: 'g1', plusOnes: 3 }]); // 2 + 1
  });

  it("dupe + 'replace' → update only, plekken set to the typed value", () => {
    const plan = planBulkAdd([row('Anouk Smit', 4)], byName, 'replace');
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([{ guestId: 'g1', plusOnes: 4 }]);
  });

  it("dupe + 'again' → insert a fresh row, no update (different person, same name)", () => {
    const plan = planBulkAdd([row('Anouk Smit', 0)], byName, 'again');
    expect(plan.updates).toEqual([]);
    expect(plan.inserts.map((r) => r.name)).toEqual(['Anouk Smit']);
    expect(plan.dupeCount).toBe(1);
  });

  it('detection: a single typed name flags only when it matches an existing guest', () => {
    expect(suspectedDuplicates([row('Anouk Smit')], byName)).toEqual(['Anouk Smit']);
    expect(suspectedDuplicates([row('Onbekend Persoon')], byName)).toEqual([]);
  });
});
