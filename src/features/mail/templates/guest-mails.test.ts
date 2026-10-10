import { describe, expect, it } from 'vitest';
import { GUEST_MAIL_TYPES, guestMailCopy, type GuestMailType } from './guest-copy';
import {
  eventDate,
  eventTime,
  formatPrice,
  locationLine,
  peopleLabel,
  renderGuestMail,
  senderName,
  type GuestMailContent,
} from './guest-mails';

const STATUS = 'https://app.plus-one.io/s/STATUS_TOKEN';
const ICS = 'https://app.plus-one.io/s/STATUS_TOKEN/calendar.ics';
const UNSUB = 'https://app.plus-one.io/u/UNSUB_TOKEN';

function content(over: Partial<GuestMailContent> = {}): GuestMailContent {
  const plusOnes = over.plusOnes ?? 0;
  return {
    type: 'guest_on_list',
    firstName: 'Lotte',
    event: {
      id: 'ee000000-0000-7000-8000-000000000001',
      name: 'Neon Friday',
      // 23:00 Amsterdam (CEST, UTC+2) on Saturday 17 October 2026
      startsAt: '2026-10-17T21:00:00Z',
      endsAt: '2026-10-18T03:00:00Z',
      location: 'Club Vesper, Keizersgracht 1',
      updatedAt: '2026-10-09T10:00:00Z',
      houseRules: null,
    },
    companyName: 'Vesper Group',
    contactEmail: 'hi@vesper.test',
    plusOnes,
    tiers: [{ name: 'Guest', people: plusOnes + 1, priceCents: null }],
    askedPeople: null,
    remark: null,
    links: { statusUrl: STATUS, icsUrl: ICS, unsubscribeUrl: UNSUB },
    ...over,
  };
}

const SPOT_TYPES: GuestMailType[] = [
  'guest_on_list',
  'guest_plus_ones',
  'guest_event_changed',
  'guest_reminder',
  'guest_request_approved',
];

describe('formatting helpers', () => {
  it('formats the event day and doors time in Amsterdam time', () => {
    expect(eventDate('2026-10-17T21:00:00Z')).toBe('Saturday 17 October');
    expect(eventTime('2026-10-17T21:00:00Z')).toBe('23:00');
  });

  it('formats a door price without inventing decimals', () => {
    expect(formatPrice(1500)).toBe('€15');
    expect(formatPrice(1250)).toBe('€12.50');
  });

  it('says 1 person, otherwise people', () => {
    expect(peopleLabel(1)).toBe('1 person');
    expect(peopleLabel(2)).toBe('2 people');
    expect(peopleLabel(4)).toBe('4 people');
  });

  it('builds the location from the event, never a company address', () => {
    expect(locationLine('Club Vesper', 'Keizersgracht 1')).toBe('Club Vesper, Keizersgracht 1');
    expect(locationLine(null, 'Keizersgracht 1')).toBe('Keizersgracht 1');
    expect(locationLine(null, null)).toBeNull();
  });
});

describe('dynamic counts', () => {
  it('never writes +0: 1 person and "Entry:" when there are no plus-ones', () => {
    for (const type of SPOT_TYPES) {
      const r = renderGuestMail(content({ type, tiers: [{ name: 'Guest', people: 1, priceCents: 1500 }] }));
      expect(r.text, type).not.toContain('+0');
      expect(r.text, type).toContain('Guest · 1 person');
      expect(r.text, type).toContain('Entry: €15, pay at the door');
      expect(r.text, type).not.toContain('Entry per person');
    }
  });

  it('+1 reads "You +1 (2 people)" and "Entry per person"', () => {
    const r = renderGuestMail(content({ plusOnes: 1, tiers: [{ name: 'Guest', people: 2, priceCents: 1500 }] }));
    expect(r.text).toContain('Guest · You +1 (2 people)');
    expect(r.text).toContain('Entry per person: €15, pay at the door');
  });

  it('+3 reads "You +3 (4 people)"', () => {
    const r = renderGuestMail(content({ plusOnes: 3, tiers: [{ name: 'Guest', people: 4, priceCents: null }] }));
    expect(r.text).toContain('Guest · You +3 (4 people)');
  });

  it('shows a price line only for a tier with a door price', () => {
    const free = renderGuestMail(content({ plusOnes: 2 }));
    expect(free.text).not.toContain('Entry');
    const zero = renderGuestMail(content({ tiers: [{ name: 'Guest', people: 1, priceCents: 0 }] }));
    expect(zero.text).not.toContain('Entry');
  });

  it('plus-ones changed: three forms', () => {
    const none = renderGuestMail(content({ type: 'guest_plus_ones', plusOnes: 0 }));
    expect(none.text).toContain(
      "Your spot for Neon Friday changed. You're now on the list without a plus-one.",
    );
    expect(none.preheader).toBe("You're now on the list without a plus-one.");
    const one = renderGuestMail(content({ type: 'guest_plus_ones', plusOnes: 1 }));
    expect(one.text).toContain("You're now on the list with +1, so 2 people in total.");
    const many = renderGuestMail(content({ type: 'guest_plus_ones', plusOnes: 3 }));
    expect(many.text).toContain("You're now on the list with +3, so 4 people in total.");
    expect(many.preheader).toBe("You're now on the list with +3.");
  });

  it('removed: the +N line is singular for +1 and plural for more, absent for none', () => {
    const base = { type: 'guest_removed' as const, tiers: null, remark: 'The list is full.' };
    expect(renderGuestMail(content({ ...base, plusOnes: 0 })).text).not.toContain('off the list too');
    expect(renderGuestMail(content({ ...base, plusOnes: 1 })).text).toContain('Your +1 is off the list too.');
    expect(renderGuestMail(content({ ...base, plusOnes: 3 })).text).toContain('Your +3 are off the list too.');
  });

  it('request approved: preheader and intro follow the count', () => {
    const none = renderGuestMail(content({ type: 'guest_request_approved' }));
    expect(none.preheader).toBe('Your request is approved for Saturday 17 October.');
    expect(none.text).toContain("Your request is approved. You're on the guest list for Neon Friday.");
    const four = renderGuestMail(
      content({ type: 'guest_request_approved', plusOnes: 3, tiers: [{ name: 'Guest', people: 4, priceCents: null }] }),
    );
    expect(four.preheader).toBe('Your request is approved. 4 people, Saturday 17 October.');
    expect(four.text).toContain("You're on the guest list for Neon Friday, 4 people in total.");
  });

  it('request partly: approved total and per-tier counts are singular/plural', () => {
    const one = renderGuestMail(
      content({
        type: 'guest_request_partly',
        askedPeople: 5,
        remark: 'Busy night.',
        tiers: [{ name: 'Guest', people: 1, priceCents: 1000 }],
      }),
    );
    expect(one.subject).toBe('On the list for Neon Friday: 1 person');
    expect(one.text).toContain("We couldn't fit all 5 people you asked for, so your spot covers 1 person.");
    expect(one.text).toContain('Your spot: 1 person');
    expect(one.text).toContain('Guest: 1 person');
    expect(one.text).toContain('Entry per person for Guest: €10, pay at the door');

    const split = renderGuestMail(
      content({
        type: 'guest_request_partly',
        plusOnes: 3,
        askedPeople: 5,
        remark: 'Busy night.',
        tiers: [
          { name: 'Backstage', people: 1, priceCents: null },
          { name: 'Guest', people: 3, priceCents: 1500 },
        ],
      }),
    );
    expect(split.subject).toBe('On the list for Neon Friday: 4 people');
    expect(split.text).toContain('Your spot: 4 people');
    expect(split.text).toContain('Backstage: 1 person');
    expect(split.text).toContain('Guest: 3 people');
    expect(split.text).not.toContain('Entry per person for Backstage');
  });

  it('request partly without an asked count above the spot reads as the approval', () => {
    const r = renderGuestMail(content({ type: 'guest_request_partly', askedPeople: null }));
    expect(r.subject).toBe("You're on the list for Neon Friday");
  });
});

describe('status link, calendar, note', () => {
  it('every mail with a spot has the status button, only when the page exists', () => {
    for (const type of [...SPOT_TYPES, 'guest_request_partly' as const]) {
      const r = renderGuestMail(content({ type, askedPeople: 5, remark: 'x' }));
      expect(r.html, type).toContain('Check your status');
      expect(r.html, type).toContain(`Button not working? Open ${STATUS}`);
      const none = renderGuestMail(content({ type, askedPeople: 5, remark: 'x', links: { statusUrl: null, icsUrl: null, unsubscribeUrl: UNSUB } }));
      expect(none.html, type).not.toContain('Check your status');
    }
  });

  it('mails without a spot have no status button, no calendar and no tier', () => {
    for (const type of ['guest_event_canceled', 'guest_removed', 'guest_request_declined'] as const) {
      const r = renderGuestMail(content({ type, tiers: null, remark: 'Sorry.' }));
      expect(r.html, type).not.toContain('Check your status');
      expect(r.html, type).not.toContain('Add to calendar');
      expect(r.text, type).not.toContain('person');
    }
  });

  it('calendar line links the .ics and Google Calendar', () => {
    const r = renderGuestMail(content());
    expect(r.html).toContain(`href="${ICS}"`);
    expect(r.html).toContain('https://calendar.google.com/calendar/render?action=TEMPLATE');
    expect(r.html).toContain('Apple or Outlook (.ics)');
  });

  it('the note shows only when written, and always where it is mandatory', () => {
    expect(renderGuestMail(content({ type: 'guest_plus_ones' })).text).not.toContain('Note from the team');
    const removed = renderGuestMail(content({ type: 'guest_removed', tiers: null, remark: 'Dress code.' }));
    expect(removed.text).toContain('Note from the team: "Dress code."');
    expect(guestMailCopy.guest_removed.noteRequired).toBe(true);
    expect(guestMailCopy.guest_request_partly.noteRequired).toBe(true);
    expect(guestMailCopy.guest_request_declined.noteRequired).toBe(true);
  });

  it('house rules only in "You\'re on the list", and only when set', () => {
    const withRules = { ...content().event, houseRules: 'No sneakers.' };
    expect(renderGuestMail(content({ event: withRules })).text).toContain('House rules: No sneakers.');
    expect(renderGuestMail(content({ type: 'guest_reminder', event: withRules })).text).not.toContain('House rules');
    expect(renderGuestMail(content()).text).not.toContain('House rules');
  });

  it('a preheader with {location} drops it when the event has no location', () => {
    const r = renderGuestMail(content({ type: 'guest_event_changed', event: { ...content().event, location: null } }));
    expect(r.preheader).toBe('Saturday 17 October, doors 23:00.');
    const withLoc = renderGuestMail(content({ type: 'guest_event_changed' }));
    expect(withLoc.preheader).toBe('Saturday 17 October, doors 23:00, Club Vesper, Keizersgracht 1.');
  });
});

describe('company name and footer', () => {
  it('keeps the company out of the subject and the body above the footer', () => {
    for (const type of GUEST_MAIL_TYPES) {
      const r = renderGuestMail(content({ type, askedPeople: 5, remark: 'ok', tiers: type === 'guest_removed' ? null : content().tiers }));
      expect(r.subject, type).not.toContain('Vesper Group');
      const body = r.text.split('\n--\n')[0];
      expect(body, type).not.toContain('Vesper Group');
    }
  });

  it('footer: reason, contact address, unsubscribe, support last', () => {
    const r = renderGuestMail(content());
    const footer = r.text.split('\n--\n')[1].split('\n');
    expect(footer[0]).toBe("You got this email because you're on the guest list for Neon Friday.");
    expect(footer[1]).toBe('Questions? Mail Vesper Group at hi@vesper.test, or reply to this email.');
    expect(footer[2]).toBe(`Don't want updates from Vesper Group? Unsubscribe: ${UNSUB} You stay on the list.`);
    expect(footer[3]).toBe('Trouble with this email? support@plus-one.io');
    expect(r.html).toContain(`href="${UNSUB}"`);
  });

  it('canceled and removed say "you were", without "You stay on the list."', () => {
    for (const type of ['guest_event_canceled', 'guest_removed'] as const) {
      const r = renderGuestMail(content({ type, tiers: null, remark: 'x' }));
      expect(r.text).toContain('because you were on the guest list');
      expect(r.text).not.toContain('You stay on the list.');
    }
  });

  it('declined names the contact address in the body', () => {
    const r = renderGuestMail(content({ type: 'guest_request_declined', tiers: null, remark: 'Full.' }));
    expect(r.text).toContain('Questions? Mail hi@vesper.test.');
    expect(r.text).toContain('because you asked for a spot');
  });

  it('greets by first name, or "Hi there" without one', () => {
    expect(renderGuestMail(content()).text).toContain('Hi Lotte,');
    expect(renderGuestMail(content({ firstName: null })).text).toContain('Hi there,');
  });
});

describe('injection', () => {
  const evil = '<img src=x onerror=alert(1)> & "quotes"';

  it('escapes every name and the note in the HTML body', () => {
    const r = renderGuestMail(
      content({
        type: 'guest_plus_ones',
        firstName: evil,
        companyName: evil,
        remark: evil,
        event: { ...content().event, name: evil, location: evil },
        tiers: [{ name: evil, people: 1, priceCents: null }],
      }),
    );
    expect(r.html).not.toContain('<img');
    expect(r.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;');
  });

  it('strips CR/LF from the subject and the sender name (header injection)', () => {
    const name = 'Party\r\nBcc: victim@example.com';
    const r = renderGuestMail(content({ event: { ...content().event, name } }));
    expect(r.subject).not.toMatch(/[\r\n]/);
    expect(r.fromName).not.toMatch(/[\r\n]/);
    expect(r.fromName).not.toContain('@');
  });

  it('sender name loses address syntax and is capped', () => {
    expect(senderName('Neon Friday')).toBe('Neon Friday via PlusOne');
    expect(senderName('"Evil" <ceo@bank.com>, x;y:z\\')).toBe('Evil ceobank.com xyz via PlusOne');
    expect(senderName('x'.repeat(200)).length).toBeLessThanOrEqual(40 + ' via PlusOne'.length);
    expect(senderName('\u0000‮')).toBe('PlusOne');
  });

  it('does not re-interpolate placeholders inside user text', () => {
    const r = renderGuestMail(content({ type: 'guest_plus_ones', remark: '{contact_email} {status_url}' }));
    expect(r.text).toContain('Note from the team: "{contact_email} {status_url}"');
  });

  it('copy has no em or en dashes', () => {
    expect(JSON.stringify(guestMailCopy)).not.toMatch(/[—–]/);
  });
});
