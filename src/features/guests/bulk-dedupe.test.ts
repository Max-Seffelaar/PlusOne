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
