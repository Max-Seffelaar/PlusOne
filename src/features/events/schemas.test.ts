import { describe, expect, it } from 'vitest';
import {
  createEventSchema,
  createTemplateSchema,
  updateTemplateSchema,
  createTemplateTierSchema,
  createEventFromTemplateSchema,
  createTemplateFromEventSchema,
  createTierSchema,
  setEventDefaultMemberQuotaSchema,
  updateTierSchema,
} from './schemas';

// Event templates (86exyp8gn) — the new Zod schemas gate every template input.
const VENUE = '00000000-0000-7000-8000-000000000001';
const TEMPLATE = '00000000-0000-7000-8000-0000000000a1';
const EVENT_ID = '00000000-0000-7000-8000-0000000000e2';

describe('createTemplateSchema', () => {
  // Sign-up link ON by default for new templates, like new events (z8uq9m0hw3).
  it('accepts a minimal template (name only) and defaults landingActive to true', () => {
    const r = createTemplateSchema.safeParse({ venueId: VENUE, name: 'Lofi Open Air' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.landingActive).toBe(true);
  });

  it('keeps an explicit landingActive: false', () => {
    const r = createTemplateSchema.safeParse({ venueId: VENUE, name: 'Lofi Open Air', landingActive: false });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.landingActive).toBe(false);
  });

  it('accepts a capacity, tri-state allowUncheck (null), and a negative auto-lock offset', () => {
    const r = createTemplateSchema.safeParse({
      venueId: VENUE,
      name: 'Lofi',
      capacity: 1800,
      allowUncheck: null,
      autoLockOffsetMinutes: -120,
    });
    expect(r.success).toBe(true);
  });

  it('rejects a zero or negative capacity', () => {
    expect(createTemplateSchema.safeParse({ venueId: VENUE, name: 'X', capacity: 0 }).success).toBe(false);
    expect(createTemplateSchema.safeParse({ venueId: VENUE, name: 'X', capacity: -5 }).success).toBe(false);
  });

  it('rejects an empty name and a non-uuid venueId', () => {
    expect(createTemplateSchema.safeParse({ venueId: VENUE, name: '   ' }).success).toBe(false);
    expect(createTemplateSchema.safeParse({ venueId: 'not-a-uuid', name: 'X' }).success).toBe(false);
  });
});

describe('updateTemplateSchema', () => {
  it('allows clearing capacity and the auto-lock offset to null', () => {
    const r = updateTemplateSchema.safeParse({ templateId: TEMPLATE, capacity: null, autoLockOffsetMinutes: null });
    expect(r.success).toBe(true);
  });
});

describe('createTemplateTierSchema', () => {
  it('lowercases, trims, and de-dupes aliases', () => {
    const r = createTemplateTierSchema.safeParse({
      templateId: TEMPLATE,
      name: 'VIP',
      aliases: [' VIP ', 'vip', 'Bottle'],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.aliases).toEqual(['vip', 'bottle']);
  });

  it('rejects a non-positive max', () => {
    expect(createTemplateTierSchema.safeParse({ templateId: TEMPLATE, name: 'V', maxGuests: 0 }).success).toBe(false);
  });

  it('rejects vatPercent on a free (no door price) tier', () => {
    const r = createTemplateTierSchema.safeParse({ templateId: TEMPLATE, name: 'V', vatPercent: 9 });
    expect(r.success).toBe(false);
  });

  it('accepts vatPercent alongside a door price', () => {
    const r = createTemplateTierSchema.safeParse({
      templateId: TEMPLATE,
      name: 'V',
      doorPriceCents: 2500,
      vatPercent: 9,
    });
    expect(r.success).toBe(true);
  });
});

// Tiers (#8, T3 — Free/Paid + VAT-%) ─────────────────────────────────────────
describe('createTierSchema', () => {
  it('accepts a free tier with no price or VAT', () => {
    const r = createTierSchema.safeParse({ eventId: EVENT_ID, name: 'Regular' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.doorPriceCents).toBeUndefined();
      expect(r.data.vatPercent).toBeUndefined();
    }
  });

  it('accepts a paid tier with a door price and VAT-%', () => {
    const r = createTierSchema.safeParse({
      eventId: EVENT_ID,
      name: 'VIP',
      doorPriceCents: 2500,
      vatPercent: 9,
    });
    expect(r.success).toBe(true);
  });

  it('rejects VAT-% on a tier with no door price', () => {
    const r = createTierSchema.safeParse({ eventId: EVENT_ID, name: 'VIP', vatPercent: 9 });
    expect(r.success).toBe(false);
  });

  it('rejects a VAT-% outside 0–100', () => {
    expect(
      createTierSchema.safeParse({ eventId: EVENT_ID, name: 'VIP', doorPriceCents: 2500, vatPercent: 150 }).success,
    ).toBe(false);
    expect(
      createTierSchema.safeParse({ eventId: EVENT_ID, name: 'VIP', doorPriceCents: 2500, vatPercent: -1 }).success,
    ).toBe(false);
  });

  it('rejects a negative door price', () => {
    expect(createTierSchema.safeParse({ eventId: EVENT_ID, name: 'VIP', doorPriceCents: -100 }).success).toBe(false);
  });
});

describe('createEventFromTemplateSchema', () => {
  const startsAt = '2026-07-01T21:00:00.000Z';

  it('accepts a template id + name + start', () => {
    expect(createEventFromTemplateSchema.safeParse({ templateId: TEMPLATE, name: 'Night', startsAt }).success).toBe(
      true,
    );
  });

  it('rejects an end before the start', () => {
    const r = createEventFromTemplateSchema.safeParse({
      templateId: TEMPLATE,
      name: 'Night',
      startsAt,
      endsAt: '2026-07-01T20:00:00.000Z',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(createEventFromTemplateSchema.safeParse({ templateId: TEMPLATE, name: '', startsAt }).success).toBe(false);
  });
});

describe('createTemplateFromEventSchema', () => {
  const EVENT = '00000000-0000-7000-8000-0000000000e1';

  it('accepts an event id + template name', () => {
    expect(createTemplateFromEventSchema.safeParse({ eventId: EVENT, name: 'Lofi Open Air' }).success).toBe(true);
  });

  it('rejects an empty name and a non-uuid event id', () => {
    expect(createTemplateFromEventSchema.safeParse({ eventId: EVENT, name: '  ' }).success).toBe(false);
    expect(createTemplateFromEventSchema.safeParse({ eventId: 'nope', name: 'X' }).success).toBe(false);
  });
});

// Per-event default member quota (T10, 86ey4j1p5) ─────────────────────────────
describe('setEventDefaultMemberQuotaSchema', () => {
  it('accepts a whole quota of 0 and reasonable positives', () => {
    expect(setEventDefaultMemberQuotaSchema.safeParse({ eventId: EVENT_ID, quota: 0 }).success).toBe(true);
    expect(setEventDefaultMemberQuotaSchema.safeParse({ eventId: EVENT_ID, quota: 25 }).success).toBe(true);
  });

  it('rejects a negative, fractional, or absurdly large quota', () => {
    expect(setEventDefaultMemberQuotaSchema.safeParse({ eventId: EVENT_ID, quota: -1 }).success).toBe(false);
    expect(setEventDefaultMemberQuotaSchema.safeParse({ eventId: EVENT_ID, quota: 2.5 }).success).toBe(false);
    expect(setEventDefaultMemberQuotaSchema.safeParse({ eventId: EVENT_ID, quota: 10000 }).success).toBe(false);
  });

  it('rejects a non-uuid event id', () => {
    expect(setEventDefaultMemberQuotaSchema.safeParse({ eventId: 'nope', quota: 5 }).success).toBe(false);
  });
});

// Sign-up link ON by default for new events (z8uq9m0hw3, item 6). The column
// default is still false, so this schema default is what createEvent writes.
describe('createEventSchema', () => {
  const base = { venueId: VENUE, name: 'FRENZY', startsAt: '2026-10-16T21:00:00.000Z' };

  it('defaults landingActive to true when the client omits it', () => {
    const r = createEventSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.landingActive).toBe(true);
  });

  it('keeps an explicit landingActive: false', () => {
    const r = createEventSchema.safeParse({ ...base, landingActive: false });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.landingActive).toBe(false);
  });
});

// Editing a tier (z8uq9m0hw3, item 5) omits aliases; the schema must keep them
// undefined (not default them to []), or the update would wipe the stored list.
describe('updateTierSchema', () => {
  const TIER = '00000000-0000-7000-8000-0000000000f1';

  it('leaves aliases undefined when the edit omits them', () => {
    const r = updateTierSchema.safeParse({ tierId: TIER, name: 'Guest', maxGuests: null, doorPriceCents: null, vatPercent: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.aliases).toBeUndefined();
  });

  it('allows clearing the max, price and VAT with null', () => {
    const r = updateTierSchema.safeParse({ tierId: TIER, maxGuests: null, doorPriceCents: null, vatPercent: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ maxGuests: null, doorPriceCents: null, vatPercent: null });
  });
});
