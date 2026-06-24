import { describe, expect, it } from 'vitest';
import {
  createTemplateSchema,
  updateTemplateSchema,
  createTemplateTierSchema,
  createEventFromTemplateSchema,
  createTemplateFromEventSchema,
} from './schemas';

// Event templates (86exyp8gn) — the new Zod schemas gate every template input.
const VENUE = '00000000-0000-7000-8000-000000000001';
const TEMPLATE = '00000000-0000-7000-8000-0000000000a1';

describe('createTemplateSchema', () => {
  it('accepts a minimal template (name only) and defaults landingActive to false', () => {
    const r = createTemplateSchema.safeParse({ venueId: VENUE, name: 'Lofi Open Air' });
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
