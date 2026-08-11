import { describe, expect, it } from 'vitest';
import {
  importContactsSchema,
  upsertContactSchema,
  upsertContactsResultSchema,
  addContactsToEventResultSchema,
} from './schemas';

const VENUE = '00000000-0000-7000-8000-000000000001';

describe('contacts fullName length (T12 — 200 → 500)', () => {
  it('accepts a realistic import row (name + email + phone + role)', () => {
    const r = importContactsSchema.safeParse({
      venueId: VENUE,
      rows: [{ fullName: 'Anouk Smit', email: 'anouk@mail.com', phone: '+31612345678', preferredRole: 'vip' }],
    });
    expect(r.success).toBe(true);
  });

  it('accepts a long-but-plausible name up to 500 chars (was rejected at 200)', () => {
    const name = 'A'.repeat(300);
    const r = importContactsSchema.safeParse({ venueId: VENUE, rows: [{ fullName: name }] });
    expect(r.success).toBe(true);
  });

  it('accepts exactly 500 chars but rejects 501', () => {
    expect(importContactsSchema.safeParse({ venueId: VENUE, rows: [{ fullName: 'x'.repeat(500) }] }).success).toBe(true);
    expect(importContactsSchema.safeParse({ venueId: VENUE, rows: [{ fullName: 'x'.repeat(501) }] }).success).toBe(false);
  });

  it('one over-long row fails the whole batch — the reason the preview must flag it before commit', () => {
    const r = importContactsSchema.safeParse({
      venueId: VENUE,
      rows: [{ fullName: 'Anouk Smit' }, { fullName: 'y'.repeat(600) }],
    });
    expect(r.success).toBe(false);
  });

  it('single-contact upsert shares the 500 cap', () => {
    expect(upsertContactSchema.safeParse({ venueId: VENUE, fullName: 'z'.repeat(500) }).success).toBe(true);
    expect(upsertContactSchema.safeParse({ venueId: VENUE, fullName: 'z'.repeat(501) }).success).toBe(false);
  });
});

describe('upsertContactsResultSchema (upsert_contacts RPC)', () => {
  const CONTACT = '00000000-0000-7000-8000-000000000002';

  it('accepts the real shape — all four fields always present', () => {
    const r = upsertContactsResultSchema.safeParse({ inserted: 2, updated: 1, skipped: 0, ids: [CONTACT] });
    expect(r.success).toBe(true);
  });

  it('rejects a missing field or a non-array ids', () => {
    expect(upsertContactsResultSchema.safeParse({ inserted: 2, updated: 1, skipped: 0 }).success).toBe(false);
    expect(
      upsertContactsResultSchema.safeParse({ inserted: 2, updated: 1, skipped: 0, ids: 'not-an-array' }).success
    ).toBe(false);
  });
});

describe('addContactsToEventResultSchema (add_contacts_to_event RPC)', () => {
  it('accepts the real shape', () => {
    expect(addContactsToEventResultSchema.safeParse({ added: 3, already: 1, skipped: 0 }).success).toBe(true);
  });

  it('rejects a missing field', () => {
    expect(addContactsToEventResultSchema.safeParse({ added: 3, already: 1 }).success).toBe(false);
  });
});
