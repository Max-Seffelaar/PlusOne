import { describe, it, expect } from 'vitest';
import { parseBulk, PLUS_ONES_MAX } from '@/features/guests/quick-add-parser';
import { t, fmt } from '@/lib/i18n';
import { buildBulkRow } from './bulk-row';

const TIERS = [{ id: 'regular', name: 'Regular', aliases: [] }];

/** The row view Paste a list renders for one pasted line. */
function view(text: string) {
  const [r] = parseBulk(text, TIERS, 'regular');
  return buildBulkRow(r, r.name, undefined);
}

// Share-import follow-up (decisions Max 2026-10-10): a pasted count column is
// the total number of people. Nonsense is flagged on its own row, never sent.
describe('buildBulkRow — pasted count column', () => {
  it('flags 0, a negative count or a word as "Check the number of people"', () => {
    expect(view('Name\tTickets\nNoor\t0').error).toBe(t.guests.bulk.errCount);
    expect(view('Name\tTickets\nNoor\t-1').error).toBe(t.guests.bulk.errCount);
    expect(view('Name\tTickets\nNoor\ttwee').error).toBe(t.guests.bulk.errCount);
  });

  it('flags more people than one line may bring (the guest schema bound)', () => {
    expect(view(`Name\tTickets\nNoor\t${PLUS_ONES_MAX + 2}`).error).toBe(
      fmt(t.guests.bulk.errCountTooMany, { max: PLUS_ONES_MAX + 1 }),
    );
    expect(view(`Name\tTickets\nNoor\t${PLUS_ONES_MAX + 1}`).error).toBeNull();
  });

  it('a valid row with a repaired phone and an e-mail has no error', () => {
    const v = view('Voornaam\tAchternaam\tAantal tickets\tEmail\tTelefoonnummer\nHenk\tAchternaam\t1\tmax+1@x.nl\t646003664');
    expect(v).toEqual({ name: 'Henk Achternaam', email: 'max+1@x.nl', phone: '+31646003664', error: null });
  });
});
