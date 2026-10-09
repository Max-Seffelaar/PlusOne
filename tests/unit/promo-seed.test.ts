/**
 * The promo demo seed (scripts/promo-seed.mjs, `pnpm promo:seed`) is shown in
 * public marketing video, so its promises are guarded here without a database:
 * it only ever runs against localhost, every event carries 75+ names and the
 * three tiers (Paid at €17.50), the quota math stays inside each person's
 * event quota, and no contact detail can belong to a real person.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPromoData,
  FIRST,
  isLocalUrl,
  LAST,
  PAID_PRICE_CENTS,
  PEOPLE,
} from '../../scripts/promo-seed.mjs';

const anchors = {
  now: new Date('2026-10-09T19:30:00Z'),
  liveStart: new Date('2026-10-09T17:00:00Z'),
  upcomingStart: new Date('2026-10-17T21:00:00Z'),
  pastStart: new Date('2026-10-03T21:00:00Z'),
};
const data = buildPromoData(anchors);
const allGuests = data.events.flatMap((e) => e.guests);

describe('local-only gate', () => {
  it('accepts only localhost and 127.0.0.1', () => {
    expect(isLocalUrl('http://127.0.0.1:55321')).toBe(true);
    expect(isLocalUrl('postgresql://postgres:postgres@localhost:55322/postgres')).toBe(true);
    expect(isLocalUrl('https://tolxwgqhppdcvnogdpel.supabase.co')).toBe(false);
    expect(isLocalUrl('postgresql://postgres@db.example.com:5432/postgres')).toBe(false);
    expect(isLocalUrl('')).toBe(false);
  });
});

describe('events', () => {
  it('builds the three nights', () => {
    expect(data.events.map((e) => e.name)).toEqual(['Velvet Hours', 'Afterglow', 'Season Opening']);
  });

  it('keeps at least 75 names on every list after removals', () => {
    for (const ev of data.events) {
      const onList = ev.guests.filter((g) => !ev.removals.includes(g.id));
      expect(onList.length, ev.name).toBeGreaterThanOrEqual(75);
    }
  });

  it('gives every event Guest, VIP and Paid at €17.50, all in use', () => {
    for (const ev of data.events) {
      expect(Object.values(ev.tiers).map((t) => t.name)).toEqual(['Guest', 'VIP', 'Paid']);
      expect(ev.tiers.paid.doorPriceCents).toBe(PAID_PRICE_CENTS);
      expect(PAID_PRICE_CENTS).toBe(1750);
      for (const tier of Object.values(ev.tiers)) {
        expect(ev.guests.some((g) => g.tierId === tier.id), `${ev.name} ${tier.name}`).toBe(true);
      }
    }
  });

  it('only checks in and refuses guests that are still on the list, once each', () => {
    for (const ev of data.events) {
      const atDoor = [...ev.checkIns.map((c) => c.guestId), ...ev.refusals.map((r) => r.guestId)];
      expect(new Set(atDoor).size).toBe(atDoor.length);
      for (const id of atDoor) expect(ev.removals).not.toContain(id);
    }
  });

  it('puts the live night inside its own window and the arrivals in time order', () => {
    const live = data.events.find((e) => e.key === 'live')!;
    expect(live.checkIns.length).toBe(70);
    const times = live.checkIns.map((c) => c.checkedAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(Math.min(...times)).toBeGreaterThan(anchors.liveStart.getTime());
    expect(Math.max(...times)).toBeLessThan(anchors.now.getTime());
  });

  it('stays inside every promoter, door host and organizer quota (1 + plus-ones a guest)', () => {
    const limits: Record<string, number> = {
      [PEOPLE.mara.id]: 30,
      [PEOPLE.daan.id]: 30,
      [PEOPLE.yasmin.id]: 30,
      [PEOPLE.kai.id]: 10,
      [PEOPLE.lotte.id]: 10,
      [PEOPLE.jesse.id]: 15,
    };
    for (const ev of data.events) {
      for (const [userId, limit] of Object.entries(limits)) {
        const used = ev.guests
          .filter((g) => g.addedBy === userId && g.source !== 'landing' && g.source !== 'permanent')
          .reduce((n, g) => n + 1 + g.plusOnes, 0);
        expect(used, `${ev.name} ${userId}`).toBeLessThanOrEqual(limit);
      }
    }
  });
});

describe('contacts and names', () => {
  it('mixes address-book guests with name-only guests and has returning guests', () => {
    const linked = allGuests.filter((g) => g.contactId);
    expect(linked.length).toBeGreaterThan(allGuests.length / 2);
    expect(allGuests.length - linked.length).toBeGreaterThan(30);
    const eventsPerContact = new Map<string, Set<string>>();
    for (const g of linked) {
      if (!eventsPerContact.has(g.contactId!)) eventsPerContact.set(g.contactId!, new Set());
      eventsPerContact.get(g.contactId!)!.add(g.eventId);
    }
    expect([...eventsPerContact.values()].filter((s) => s.size > 1).length).toBeGreaterThan(20);
  });

  it('has no duplicates: one name per person, each first name at most twice in the venue', () => {
    // A person = a contact, a name-only guest, or an open/declined request.
    const people = [
      ...data.contacts.map((c) => c.fullName),
      ...allGuests.filter((g) => !g.contactId).map((g) => g.fullName),
      ...data.events.flatMap((e) => e.requests.filter((r) => r.status !== 'approved').map((r) => r.fullName)),
      ...Object.values(PEOPLE).map((p) => p.name),
    ];
    expect(new Set(people).size).toBe(people.length);

    const firstNames = new Map<string, number>();
    for (const n of people) firstNames.set(n.split(' ')[0], (firstNames.get(n.split(' ')[0]) ?? 0) + 1);
    const over = [...firstNames].filter(([, count]) => count > 2);
    expect(over).toEqual([]);

    expect(new Set(FIRST).size).toBe(FIRST.length);
    expect(new Set(LAST).size).toBe(LAST.length);
  });

  it('gives every e-mail address to one person only', () => {
    const owners = new Map<string, string>();
    const claim = (email: string | null, name: string) => {
      if (!email) return;
      expect(owners.get(email) ?? name, email).toBe(name);
      owners.set(email, name);
    };
    data.contacts.forEach((c) => claim(c.email, c.fullName));
    allGuests.forEach((g) => claim(g.email, g.fullName));
    data.events.forEach((e) => e.requests.forEach((r) => claim(r.email, r.fullName)));
  });

  it('never puts a contact on the same event twice', () => {
    for (const ev of data.events) {
      const ids = ev.guests.filter((g) => g.contactId).map((g) => g.contactId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('uses only reserved e-mail domains and the fixed fake phone series', () => {
    const emails = [
      ...data.contacts.map((c) => c.email),
      ...allGuests.map((g) => g.email),
      ...data.events.flatMap((e) => e.requests.map((r) => r.email)),
    ].filter((e): e is string => e !== null);
    for (const e of emails) expect(e).toMatch(/^[a-z]+\.[a-z]+@example\.com$/);
    for (const p of Object.values(PEOPLE)) expect(p.email).toMatch(/@kelder-nord\.test$/);

    const phones = [
      ...data.contacts.map((c) => c.phone),
      ...allGuests.map((g) => g.phone),
      ...data.events.flatMap((e) => e.requests.map((r) => r.phone)),
    ].filter((p): p is string => p !== null);
    for (const p of phones) expect(p).toMatch(/^\+3160000\d{4}$/);
    const contactPhones = data.contacts.map((c) => c.phone).filter(Boolean);
    expect(new Set(contactPhones).size).toBe(contactPhones.length);
  });

  it('never uses a real seed name or a persona name for a guest', () => {
    const names = new Set([...data.contacts.map((c) => c.fullName), ...allGuests.map((g) => g.fullName)]);
    expect([...names].some((n) => /Juri|Braakman/.test(n))).toBe(false);
    for (const p of Object.values(PEOPLE)) expect(names.has(p.name)).toBe(false);
    expect(FIRST).not.toContain('Juri');
    expect(LAST).not.toContain('Braakman');
  });
});
