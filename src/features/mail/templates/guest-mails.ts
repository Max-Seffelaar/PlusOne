// Guest-mail renderer (Gastcommunicatie F, z8uq9m2vpy). Pure: copy in
// (./guest-copy.ts), subject/preheader/html/text and the sender name out.
// Same injection rules as the team and billing mails (../templates.ts),
// tested in guest-mails.test.ts:
//   * Body: every variable is HTML-escaped AFTER interpolation into plain copy,
//     so an event, tier, guest or company name like `<a href=…>` renders as
//     text. URLs are escaped in attributes too.
//   * Subject and sender name: plain text (no entities), control characters
//     stripped (header injection), each name capped. The sender name also
//     loses the characters that carry meaning in an address header
//     ("<>@,;:\), so "{event_name} via PlusOne" can never smuggle in an
//     address or a second mailbox.
// Every count is dynamic (decision Max 2026-10-09): +0 is never written, "1
// person" vs "n people" everywhere, "Entry:" vs "Entry per person:".

import { fmt } from '@/lib/i18n';
import { escapeHtml, plainLine } from '../templates';
import { googleCalendarUrl, type CalendarEvent } from '../ics';
import { guestMailCopy, guestMailShared, type ByPlusOnes, type GuestMailType } from './guest-copy';

const NAME_MAX = 80;
/** The sender's display name stays short in an inbox list. */
const SENDER_EVENT_MAX = 40;
const TZ = 'Europe/Amsterdam';

export interface GuestMailTier {
  name: string;
  /** People on this tier, the guest included when it is their tier. */
  people: number;
  priceCents: number | null;
}

export interface GuestMailContent {
  type: GuestMailType;
  firstName: string | null;
  event: CalendarEvent & { houseRules: string | null };
  companyName: string;
  contactEmail: string;
  /** The guest's current +N (0 for a declined request). */
  plusOnes: number;
  /** The spot per tier (one entry today; a split over tiers lists each). Null = no spot in this mail. */
  tiers: GuestMailTier[] | null;
  /** request_partly: how many people were asked for, the requester included. */
  askedPeople: number | null;
  remark: string | null;
  links: {
    statusUrl: string | null;
    icsUrl: string | null;
    unsubscribeUrl: string;
  };
}

export interface RenderedGuestMail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  /** The display name of the sender: "{event_name} via PlusOne". */
  fromName: string;
}

function cleanName(value: string, max = NAME_MAX): string {
  const line = plainLine(value);
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Free text from the team (note, house rules): one paragraph, no controls. */
function cleanText(value: string): string {
  return plainLine(value).slice(0, 500);
}

/** "Saturday 18 October" in Amsterdam time. */
export function eventDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

/** "23:00" in Amsterdam time. */
export function eventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** "€15" or "€12.50". */
export function formatPrice(cents: number): string {
  const euros = cents / 100;
  return Number.isInteger(euros) ? `€${euros}` : `€${euros.toFixed(2)}`;
}

/** "1 person" / "4 people". */
export function peopleLabel(total: number): string {
  return total === 1 ? guestMailShared.person : fmt(guestMailShared.people, { total });
}

function pick(value: string | ByPlusOnes, plusOnes: number): string {
  if (typeof value === 'string') return value;
  if (plusOnes <= 0) return value.none;
  return plusOnes === 1 ? value.one : value.many;
}

/** "Club Vesper, Keizersgracht 1": the event's own place (never the company address). */
export function locationLine(name: string | null, address: string | null): string | null {
  const parts = [name, address].map((p) => (p ? plainLine(p) : '')).filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** "{event_name} via PlusOne", safe for a From header display name. */
export function senderName(eventName: string): string {
  const name = cleanName(eventName, SENDER_EVENT_MAX).replace(/["<>@,;:\\]/g, '').replace(/\s+/g, ' ').trim();
  return name ? fmt(guestMailShared.sender, { event_name: name }) : 'PlusOne';
}

export function renderGuestMail(content: GuestMailContent): RenderedGuestMail {
  const copy = guestMailCopy[content.type];
  const s = guestMailShared;
  const plusOnes = Math.max(0, Math.trunc(content.plusOnes || 0));
  const tiers = content.tiers ?? [];
  const spotPeople = tiers.length > 0 ? tiers.reduce((sum, t) => sum + t.people, 0) : plusOnes + 1;
  const location = content.event.location;

  // request_partly needs the asked-for count above what was approved;
  // without it, it reads as the plain approval.
  const type: GuestMailType =
    content.type === 'guest_request_partly' && !(content.askedPeople && content.askedPeople > spotPeople)
      ? 'guest_request_approved'
      : content.type;
  const c = type === content.type ? copy : guestMailCopy[type];

  const firstName = cleanName(content.firstName ?? '');
  const vars: Record<string, string | number> = {
    guest_first_name: firstName,
    event_name: cleanName(content.event.name),
    event_date: eventDate(content.event.startsAt),
    event_time: eventTime(content.event.startsAt),
    location: location ? cleanName(location, 200) : '',
    n: plusOnes,
    total: plusOnes + 1,
    people: peopleLabel(spotPeople),
    asked: content.askedPeople ?? '',
    company: cleanName(content.companyName),
    contact_email: plainLine(content.contactEmail),
    status_url: content.links.statusUrl ?? '',
    remark: content.remark ? cleanText(content.remark) : '',
    house_rules: content.event.houseRules ? cleanText(content.event.houseRules) : '',
  };
  const fill = (str: string) => fmt(str, vars);
  // Preheaders that end in ", {location}." lose that part without a location.
  const fillPreheader = (str: string) => fill(location ? str : str.replace(', {location}.', '.'));

  const subject = plainLine(fill(pick(c.subject, plusOnes)));
  const preheader = plainLine(fillPreheader(pick(c.preheader, plusOnes)));
  const greeting = firstName ? fill(s.greeting) : s.greetingNoName;
  const intro = fill(pick(c.intro, plusOnes));
  const noteText = vars.remark ? fill(s.note) : null;

  // The details block: what, when, where, and the spot.
  const detailLines: string[] = [fill(s.when)];
  if (location) detailLines.push(String(vars.location));
  const spotLines: string[] = [];
  const priceLines: string[] = [];
  if (type === 'guest_request_partly') {
    spotLines.push(fill(s.spotTotal));
    for (const tier of tiers) {
      spotLines.push(fmt(s.tierCount, { tier_name: cleanName(tier.name), people: peopleLabel(tier.people) }));
      if (tier.priceCents !== null && tier.priceCents > 0) {
        priceLines.push(fmt(s.priceForTier, { tier_name: cleanName(tier.name), tier_price: formatPrice(tier.priceCents) }));
      }
    }
  } else {
    for (const tier of tiers) {
      const tierVars = { tier_name: cleanName(tier.name), n: plusOnes, total: plusOnes + 1 };
      spotLines.push(fmt(pick(s.tierLine, plusOnes), tierVars));
      if (tier.priceCents !== null && tier.priceCents > 0) {
        priceLines.push(
          fmt(plusOnes > 0 ? s.pricePerPerson : s.priceSingle, { tier_price: formatPrice(tier.priceCents) }),
        );
      }
    }
  }

  const calendar: CalendarEvent = content.event;
  const icsUrl = content.links.icsUrl;
  const googleUrl = googleCalendarUrl(calendar);
  const statusUrl = content.links.statusUrl;
  const houseRules = vars.house_rules ? fill(s.houseRules) : null;
  const after = c.after ? fill(c.after) : null;

  const reason = fill(c.reason === 'onList' ? s.reasonOnList : c.reason === 'wasOnList' ? s.reasonWasOnList : s.reasonAsked);
  const questions = fill(s.questions);
  const unsubLead = fill(s.unsubscribeLead);
  const unsubUrl = content.links.unsubscribeUrl;

  const has = (block: (typeof c.blocks)[number]) => c.blocks.includes(block);
  const showNote = has('note') && noteText !== null;
  const showCalendar = has('calendar') && Boolean(icsUrl);
  const showStatus = has('status') && Boolean(statusUrl);
  const showDetails = has('details');

  // ---- plain text ----------------------------------------------------------
  const textParts: string[] = [String(vars.event_name), '', greeting, ''];
  for (const block of c.blocks) {
    if (block === 'intro') textParts.push(intro, '');
    if (block === 'note' && showNote) textParts.push(noteText as string, '');
    if (block === 'details' && showDetails) {
      textParts.push(String(vars.event_name), ...detailLines, ...spotLines, ...priceLines, '');
    }
    if (block === 'calendar' && showCalendar) {
      textParts.push(`${s.calendarLead} ${s.calendarIcs}: ${icsUrl}`, `${s.calendarGoogle}: ${googleUrl}`, '');
    }
    if (block === 'after' && after) textParts.push(after, '');
    if (block === 'houseRules' && houseRules) textParts.push(houseRules, '');
    if (block === 'status' && showStatus) textParts.push(`${s.statusButton}: ${statusUrl}`, '');
  }
  textParts.push(
    '--',
    reason,
    questions,
    `${unsubLead} ${s.unsubscribeLink}: ${unsubUrl}${c.staysOnList ? ` ${s.unsubscribeStay}` : ''}`,
    s.trouble,
  );
  const text = textParts.join('\n');

  // ---- html ------------------------------------------------------------------
  // No images, by decision (deliverability + no remote content). Same frame
  // as the team and billing mails; the preheader is the hidden preview line.
  const e = escapeHtml;
  const P = 'margin:0 0 16px;font-size:16px;line-height:1.5;';
  const F = 'margin:0 0 8px;font-size:12px;line-height:1.5;color:#77737f;';
  const A = 'color:#0B0B0D;text-decoration:underline;';
  const htmlBlocks: string[] = [];
  for (const block of c.blocks) {
    if (block === 'intro') htmlBlocks.push(`<p style="${P}">${e(intro)}</p>`);
    if (block === 'note' && showNote) {
      htmlBlocks.push(
        `<p style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #B5A6FF;background:#f7f5ff;font-size:15px;line-height:1.5;">${e(noteText as string)}</p>`,
      );
    }
    if (block === 'details' && showDetails) {
      const rows = [
        `<p style="margin:0 0 4px;font-weight:700;font-size:16px;">${e(String(vars.event_name))}</p>`,
        ...detailLines.map((l) => `<p style="margin:0 0 4px;font-size:15px;line-height:1.5;">${e(l)}</p>`),
        ...spotLines.map((l) => `<p style="margin:8px 0 0;font-size:15px;line-height:1.5;font-weight:600;">${e(l)}</p>`),
        ...priceLines.map((l) => `<p style="margin:4px 0 0;font-size:14px;line-height:1.5;color:#55525e;">${e(l)}</p>`),
      ];
      htmlBlocks.push(
        `<div style="margin:0 0 16px;padding:16px;border-radius:8px;background:#f4f3f8;">${rows.join('')}</div>`,
      );
    }
    if (block === 'calendar' && showCalendar) {
      htmlBlocks.push(
        `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;">${e(s.calendarLead)} <a href="${e(icsUrl as string)}" style="${A}">${e(s.calendarIcs)}</a> · <a href="${e(googleUrl)}" style="${A}">${e(s.calendarGoogle)}</a></p>`,
      );
    }
    if (block === 'after' && after) htmlBlocks.push(`<p style="${P}">${e(after)}</p>`);
    if (block === 'houseRules' && houseRules) {
      htmlBlocks.push(`<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#55525e;">${e(houseRules)}</p>`);
    }
    if (block === 'status' && showStatus) {
      htmlBlocks.push(
        `<p style="margin:8px 0 12px;"><a href="${e(statusUrl as string)}" style="display:inline-block;background:#B5A6FF;color:#0B0B0D;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;">${e(s.statusButton)}</a></p>`,
        `<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#55525e;word-break:break-all;overflow-wrap:anywhere;">${e(fill(s.statusFallback))}</p>`,
      );
    }
  }
  const unsubHtml = `${e(unsubLead)} <a href="${e(unsubUrl)}" style="color:#77737f;text-decoration:underline;">${e(s.unsubscribeLink)}</a>${c.staysOnList ? `. ${e(s.unsubscribeStay)}` : ''}`;

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f3f8;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#0B0B0D;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(preheader)}</div>
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${e(String(vars.event_name))}</h1>
<p style="${P}">${e(greeting)}</p>
${htmlBlocks.join('\n')}
<hr style="border:none;border-top:1px solid #e6e4ee;margin:8px 0 16px;">
<p style="${F}">${e(reason)}</p>
<p style="${F}">${e(questions)}</p>
<p style="${F}">${unsubHtml}</p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#77737f;">${e(s.trouble)}</p>
</div>
</body>
</html>`;

  return { subject, preheader, html, text, fromName: senderName(content.event.name) };
}
