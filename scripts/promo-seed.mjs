// Promo demo data — "Kelder Nord" (reels + trailer). LOCAL STACK ONLY.
//
// Builds a complete, fictional company on top of a fresh local stack so the
// promo shots (Higgsfield storyboard) show a venue that is properly in use:
//
//   * its own venue, "Kelder Nord", comped, onboarding done, and nine people:
//     two admins, finance, three promoters (staff, with a quota), two door
//     hosts and one external organizer (event scope only). Log in with
//     /auth/dev-login?email=owner@kelder-nord.test&next=/app — no MFA.
//   * three events, each with three tiers (Guest, VIP, Paid at €17.50 at the
//     door) and 75+ names on the list:
//       Velvet Hours    LIVE right now, ~70 inside, list locked, 2 refusals
//       Afterglow       next Saturday, list filling, 6 open requests, 2 quota requests
//       Season Opening  a past Saturday, full recap (~81% turnout, no-shows, refusals)
//   * 180 contacts (12 regulars on every list), reused across the events, plus
//     name-only guests — the mix a real night has.
//   * four request links per event (three promoters + one influencer) with
//     page views, so the Promotion funnel and leaderboard are filled.
//
// Why a separate venue and not the store seed's Club Vesper: Club Vesper comes
// from supabase/seed.sql, which pgTAP relies on row for row, so its names
// (Juri Braakman and friends) and its @clubvesper.nl addresses cannot change.
// The Kelder Nord people are members of Kelder Nord only, so none of the
// seed.sql rows ever shows up in a promo shot.
//
// Every write runs in ONE transaction over a direct Postgres connection (the
// local stack's superuser, so RLS is bypassed exactly as in seed.sql), with
// `request.jwt.claims` set to the person doing that step. auth.uid() then
// returns that person, so the audit triggers write the log under real names
// ("Mara Jansen added …", "Lotte Visser checked in …"). Nothing is bypassed:
// quota, capacity, scope and status-sync triggers all fire, and nothing is
// hard-deleted (CLAUDE.md, #21). Audit rows carry the time the script ran;
// check-ins and refusals carry realistic times across each night.
//
// Contact data is fake by construction: e-mail on example.com (RFC 2606,
// reserved) and phones +31600000001… in one fixed series.
//
// Idempotent: if Kelder Nord already exists the script changes nothing and
// says whether the live night is still live. Times are anchored at the moment
// of the run; for a fresh live night, reset the stack first
// (`supabase db reset`, or `pnpm db:fresh`) and run this again. The usual
// one-DB-owner rule applies to that reset.
//
//   pnpm promo:seed

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

// ── env + hard gate ──────────────────────────────────────────────────────────

function loadEnvLocal() {
  try {
    const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    // No .env.local — the shell must export the vars.
  }
}

/** Exported for the unit guard: true only for a localhost / 127.0.0.1 hostname. */
export function isLocalUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

const DEFAULT_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

// ── fixed ids ────────────────────────────────────────────────────────────────

/** v7-shaped fixed id: `b0<kind>00000-0000-7000-8000-<n>`, kind = one hex digit. */
export const uid = (kind, n) => `b0${kind}00000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const K = {
  user: '1',
  venue: '2',
  event: '3',
  tier: '4',
  contact: '5',
  guest: '6',
  checkIn: '7',
  refusal: '8',
  request: '9',
  influencer: 'a',
  link: 'b',
  quotaRequest: 'c',
};

export const VENUE = {
  id: uid(K.venue, 1),
  name: 'Kelder Nord',
  slug: 'kelder-nord',
  companyName: 'Kelder Nord B.V.',
  kvk: '00000000',
  vat: 'NL000000000B01',
  financeEmail: 'finance@kelder-nord.test',
  address: 'Havenkade 41',
  postalCode: '1031 KN',
  city: 'Amsterdam',
};

/** roles null = no membership (event-scoped organizer). */
export const PEOPLE = {
  robin: { id: uid(K.user, 1), email: 'owner@kelder-nord.test', name: 'Robin Vermeer', roles: ['admin'], title: 'Owner' },
  noa: { id: uid(K.user, 2), email: 'manager@kelder-nord.test', name: 'Noa Bakker', roles: ['admin'], title: 'Venue manager' },
  ilse: { id: uid(K.user, 3), email: 'finance@kelder-nord.test', name: 'Ilse de Boer', roles: ['finance'], title: 'Finance' },
  mara: { id: uid(K.user, 4), email: 'mara@kelder-nord.test', name: 'Mara Jansen', roles: ['staff'], title: 'Promoter' },
  daan: { id: uid(K.user, 5), email: 'daan@kelder-nord.test', name: 'Daan Kok', roles: ['staff'], title: 'Promoter' },
  yasmin: { id: uid(K.user, 6), email: 'yasmin@kelder-nord.test', name: 'Yasmin El Amrani', roles: ['staff'], title: 'Promoter' },
  kai: { id: uid(K.user, 7), email: 'kai@kelder-nord.test', name: 'Kai Mulder', roles: ['doorhost'], title: 'Door host' },
  lotte: { id: uid(K.user, 8), email: 'lotte@kelder-nord.test', name: 'Lotte Visser', roles: ['doorhost', 'staff'], title: 'Head of door' },
  jesse: { id: uid(K.user, 9), email: 'organizer@kelder-nord.test', name: 'Jesse Pinas', roles: null, title: null },
};

const PROMOTERS = ['mara', 'daan', 'yasmin'];
/** Venue-level default per person; every event overrides it (EVENT_QUOTA). */
const VENUE_QUOTA = { mara: 20, daan: 20, yasmin: 20, kai: 10, lotte: 10 };
const EVENT_QUOTA = { mara: 30, daan: 30, yasmin: 30, kai: 10, lotte: 10 };
const ORGANIZER_QUOTA = 15;

export const PAID_PRICE_CENTS = 1750;

// ── names (fictional; no persona's name, no seed.sql name) ──────────────────

// No duplicates, not even look-alikes: every person in the venue gets a unique
// full name, and a first name is used at most twice in the whole venue (the
// door list sorts by first name, so repeats sit in a row and read as doubles).
// namePool() hands them out round by round.
export const FIRST = [
  'Noah', 'Emma', 'Liam', 'Sara', 'Milan', 'Yara', 'Levi', 'Nina', 'Sem', 'Lina',
  'Finn', 'Zoë', 'Luca', 'Isa', 'Jayden', 'Amira', 'Thijs', 'Fleur', 'Omar', 'Julia',
  'Ruben', 'Elif', 'Sven', 'Maud', 'Hugo', 'Ines', 'Tygo', 'Romy', 'Mehmet', 'Saar',
  'Bram', 'Femke', 'Joep', 'Lieke', 'Stijn', 'Anouk', 'Gijs', 'Evi', 'Mats', 'Puck',
  'Ilias', 'Hanna', 'Bilal', 'Noor', 'Timo', 'Jade', 'Rayan', 'Vera', 'Cas', 'Selin',
  'Wout', 'Esmee', 'Ayoub', 'Floor', 'Jens', 'Merel', 'Dex', 'Senna', 'Ibrahim', 'Tess',
  'Kian', 'Liv', 'Britt', 'Olaf', 'Naomi', 'Quinten', 'Roos', 'Youssef', 'Sophie', 'Teun',
  'Mila', 'Boaz', 'Hamza', 'Jasmijn', 'Pepijn', 'Fenna', 'Ravi', 'Iris', 'Mustafa', 'Chloé',
  'Niels', 'Elin', 'Tarik', 'Bo', 'Rosa', 'Victor', 'Lena', 'Sami', 'Ella', 'Jurre',
  'Aaron', 'Abel', 'Aisha', 'Amber', 'Anas', 'Annika', 'Arjen', 'Aya', 'Benthe', 'Bas',
  'Cato', 'Daphne', 'Dewi', 'Dylan', 'Eline', 'Emir', 'Fatima', 'Guus', 'Hidde', 'Imane',
  'Isabel', 'Jamal', 'Jasper', 'Joris', 'Kaya', 'Koen', 'Lars', 'Laila', 'Maren', 'Mick',
  'Nadia', 'Nora', 'Oscar', 'Pien', 'Rick', 'Rania', 'Silke', 'Sander', 'Tara', 'Thomas',
  'Uma', 'Valentijn', 'Wessel', 'Xander', 'Yusra', 'Zakaria', 'Zara', 'Feline', 'Jules', 'Nienke',
];
export const LAST = [
  'de Jong', 'Peters', 'van Dijk', 'Smit', 'Meijer', 'de Graaf', 'Hendriks', 'Bos', 'Vos', 'Dekker',
  'van Leeuwen', 'Brouwer', 'de Wit', 'Dijkstra', 'Schouten', 'Kuipers', 'Postma', 'Hoekstra', 'Koster', 'Prins',
  'Willems', 'Haddad', 'Okafor', 'Yilmaz', 'Costa', 'Novak', 'Rossi', 'Moreau', 'Santos', 'El Idrissi',
  'Verbeek', 'Kramer', 'Bosman', 'van der Meer', 'Bulut', 'Mendes', 'Achterberg', 'Lammers', 'Groen', 'Wouters',
];

/** Small deterministic PRNG, so every run builds the same night. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Unique names in rounds: each round uses every first name once, in a fixed
 * shuffled order, and gives first name j the last name (7j + 13r) mod 40 in
 * round r. 13 is coprime with 40, so a first name never meets the same last
 * name twice; the first 2 × 150 people use each first name at most twice.
 */
function namePool(rand) {
  const firsts = shuffled(FIRST, rand);
  const out = [];
  for (let round = 0; round < LAST.length; round++) {
    firsts.forEach((first, j) => out.push({ first, last: LAST[(j * 7 + round * 13) % LAST.length] }));
  }
  return out;
}

const ascii = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const emailFor = (first, last) => `${ascii(first)}.${ascii(last).replace(/[^a-z]/g, '')}@example.com`;
export const phoneFor = (n) => `+316${String(n).padStart(8, '0')}`;

const CONTACT_COUNT = 180;
const REGULARS = 12;
const PLUS = [0, 1, 0, 2, 0, 0, 1, 0, 3, 0, 1, 0, 0, 2];

// ── the plan (pure: anchors in, rows out — unit-tested) ──────────────────────

const EVENT_SPECS = [
  {
    key: 'live', n: 1, name: 'Velvet Hours', slug: 'velvet-hours', hours: 7, rows: 120,
    promoters: { mara: 9, daan: 8, yasmin: 7 }, organizer: 0, door: 3, landing: 30,
    admins: { robin: 31, noa: 20 }, removed: 3, checkIns: 70, refusals: 2,
    pendingRequests: 0, deniedRequests: 1, lock: true,
  },
  {
    key: 'upcoming', n: 2, name: 'Afterglow', slug: 'afterglow', hours: 6, rows: 88,
    promoters: { mara: 10, daan: 9, yasmin: 8 }, organizer: 6, door: 0, landing: 20,
    admins: { robin: 14, noa: 9 }, removed: 2, checkIns: 0, refusals: 0,
    pendingRequests: 6, deniedRequests: 2, lock: false,
    quotaRequests: [
      { who: 'mara', extra: 6, motivation: 'Birthday group of six' },
      { who: 'daan', extra: 4, motivation: 'Crew from the record label' },
    ],
  },
  {
    key: 'past', n: 3, name: 'Season Opening', slug: 'season-opening', hours: 6, rows: 96,
    promoters: { mara: 9, daan: 8, yasmin: 8 }, organizer: 0, door: 2, landing: 25,
    admins: { robin: 20, noa: 12 }, removed: 2, checkIns: 0.81, refusals: 4,
    pendingRequests: 0, deniedRequests: 1, lock: true,
  },
];

const INFLUENCERS = [
  { key: 'mara', n: 1, name: 'Mara Jansen', handle: '@mara.nights', userKey: 'mara', share: 0.25 },
  { key: 'daan', n: 2, name: 'Daan Kok', handle: '@daankok', userKey: 'daan', share: 0.2 },
  { key: 'yasmin', n: 3, name: 'Yasmin El Amrani', handle: '@yasmin.ea', userKey: 'yasmin', share: 0.12 },
  { key: 'nova', n: 4, name: 'Nova Reyes', handle: '@novareyes', userKey: null, share: 0.38 },
];

const NOTES = [
  { note: 'Birthday group, keep them together', priority: 'high' },
  { note: 'Tour manager, needs backstage access', priority: 'high' },
  { note: 'Friends of the headliner', priority: 'low' },
  { note: 'Press, has a camera with them', priority: 'low' },
];

const MOTIVATIONS = [
  'Friends of the DJ',
  'Birthday, coming with my sister',
  null,
  'Photographer for the night',
  null,
  'Was here at Velvet Hours, loved it',
];

const REFUSAL_REASONS = ['Dress code', 'No valid ID', 'Too intoxicated', 'Dress code'];

const minutesAfter = (date, m) => new Date(date.getTime() + m * 60_000);

/**
 * The whole dataset for given time anchors. Pure, so the unit test can check
 * the invariants (75+ per event, three tiers, fake contact data) without a DB.
 * @param {{ now: Date, liveStart: Date, upcomingStart: Date, pastStart: Date }} anchors
 */
export function buildPromoData(anchors) {
  const rand = mulberry32(41);
  const names = namePool(rand);
  let nameCursor = 0;
  const nextName = () => {
    if (nameCursor >= names.length) throw new Error('promo seed: ran out of unique names');
    return names[nameCursor++];
  };

  // Contacts: the first REGULARS are regulars (on every list).
  const contacts = Array.from({ length: CONTACT_COUNT }, (_, i) => {
    const { first, last } = nextName();
    const regular = i < REGULARS;
    return {
      id: uid(K.contact, i + 1),
      fullName: `${first} ${last}`,
      // Most have both; some only e-mail, some only a phone (what people leave).
      email: i % 7 === 3 ? null : emailFor(first, last),
      phone: i % 5 === 2 ? null : phoneFor(i + 1),
      birthdate: i % 3 === 0 ? `19${90 + (i % 10)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}` : null,
      preferredRole: regular ? (i < 7 ? 'vip' : 'guest') : i % 9 === 0 ? 'vip' : null,
      isPermanent: regular,
      source: i % 4 === 0 ? 'import' : i % 4 === 1 ? 'guest_list' : 'manual',
    };
  });
  const regulars = contacts.slice(0, REGULARS);
  const pool = contacts.slice(REGULARS);

  const influencers = INFLUENCERS.map((inf) => ({
    id: uid(K.influencer, inf.n),
    name: inf.name,
    handle: inf.handle,
    userId: inf.userKey ? PEOPLE[inf.userKey].id : null,
  }));

  let guestN = 0;
  let checkInN = 0;
  let refusalN = 0;
  let requestN = 0;

  const events = EVENT_SPECS.map((spec, e) => {
    const eventId = uid(K.event, spec.n);
    const start = spec.key === 'live' ? anchors.liveStart : spec.key === 'upcoming' ? anchors.upcomingStart : anchors.pastStart;
    const end = minutesAfter(start, spec.hours * 60);
    const tiers = {
      guest: { id: uid(K.tier, spec.n * 10 + 1), name: 'Guest', color: '#8A8A93', aliases: [], doorPriceCents: null },
      vip: { id: uid(K.tier, spec.n * 10 + 2), name: 'VIP', color: '#B5A6FF', aliases: ['vip'], doorPriceCents: null },
      paid: { id: uid(K.tier, spec.n * 10 + 3), name: 'Paid', color: '#7FD1B9', aliases: ['paid', 'ticket'], doorPriceCents: PAID_PRICE_CENTS },
    };
    const pickTier = (vipShare) => {
      const r = rand();
      return r < vipShare ? tiers.vip.id : r < vipShare + 0.27 ? tiers.paid.id : tiers.guest.id;
    };

    const links = INFLUENCERS.map((inf) => ({
      id: uid(K.link, spec.n * 10 + inf.n),
      influencerKey: inf.key,
      influencerId: uid(K.influencer, inf.n),
      slug: `${spec.slug}-${inf.handle.replace(/[^a-z0-9]/gi, '').toLowerCase()}`,
      // The influencer sells the paid door deal; promoters bring the free list.
      tierId: inf.key === 'nova' ? tiers.paid.id : tiers.guest.id,
      autoApprove: inf.key === 'nova',
      share: inf.share,
    }));

    // A rotating window over the contact pool: every event takes a different
    // slice, overlapping the next one, so returning guests exist.
    let poolCursor = e * 52;
    const nextContact = () => pool[poolCursor++ % pool.length];

    const guests = [];
    const add = (g) => {
      guestN += 1;
      const row = {
        id: uid(K.guest, guestN),
        eventId,
        tierId: g.tierId,
        fullName: g.fullName,
        email: g.email ?? null,
        phone: g.phone ?? null,
        contactId: g.contactId ?? null,
        plusOnes: g.plusOnes ?? 0,
        note: null,
        notePriority: 'none',
        addedBy: g.addedBy,
        source: g.source,
        requestLinkId: g.requestLinkId ?? null,
      };
      guests.push(row);
      return row;
    };
    const fromContact = (c) => ({ fullName: c.fullName, email: c.email, phone: c.phone, contactId: c.id });
    const nameOnly = () => {
      const { first, last } = nextName();
      return { fullName: `${first} ${last}` };
    };

    // Regulars: what the permanent sync would add (same columns as
    // sync_permanent_guests_into_event), with fixed ids.
    for (const c of regulars) {
      add({
        ...fromContact(c),
        tierId: c.preferredRole === 'vip' ? tiers.vip.id : tiers.guest.id,
        addedBy: PEOPLE.robin.id,
        source: 'permanent',
      });
    }

    // Admin adds: mostly from the address book, some typed by name.
    for (const [who, count] of Object.entries(spec.admins)) {
      for (let i = 0; i < count; i++) {
        add({
          ...(i % 3 === 2 ? nameOnly() : fromContact(nextContact())),
          tierId: pickTier(0.22),
          plusOnes: PLUS[(guestN + i) % PLUS.length],
          addedBy: PEOPLE[who].id,
          source: 'app',
        });
      }
    }

    // Promoter adds: half address book, half "Sam +2" quick adds.
    for (const [who, count] of Object.entries(spec.promoters)) {
      for (let i = 0; i < count; i++) {
        add({
          ...(i % 2 === 0 ? fromContact(nextContact()) : nameOnly()),
          tierId: pickTier(0.3),
          plusOnes: PLUS[(i * 3 + who.length) % PLUS.length],
          addedBy: PEOPLE[who].id,
          source: 'app',
        });
      }
    }

    for (let i = 0; i < spec.organizer; i++) {
      add({ ...fromContact(nextContact()), tierId: pickTier(0.25), plusOnes: [1, 0, 2, 0, 1, 0][i % 6], addedBy: PEOPLE.jesse.id, source: 'app' });
    }

    // Door adds by Lotte (the lead door host, REF-1 in the storyboard): name
    // only, no plus-ones, inside her door quota.
    for (let i = 0; i < spec.door; i++) {
      add({ ...nameOnly(), tierId: tiers.paid.id, addedBy: PEOPLE.lotte.id, source: 'door' });
    }

    // Landing sign-ups through the request links, approved by Robin (or auto).
    const requests = [];
    const linkFor = (i) => {
      const r = (i + 0.5) / spec.landing;
      let acc = 0;
      for (const l of links) {
        acc += l.share;
        if (r <= acc) return l;
      }
      return links[links.length - 1];
    };
    for (let i = 0; i < spec.landing; i++) {
      const c = nextContact();
      const link = linkFor(i);
      const plusOnes = PLUS[(i * 5) % PLUS.length];
      // Same added_by as the real paths: approve_guest_request stamps the
      // approver, an auto-approve link (submit_guest_request) stamps nobody.
      const guest = add({
        ...fromContact(c),
        tierId: link.tierId,
        plusOnes,
        addedBy: link.autoApprove ? null : PEOPLE.robin.id,
        source: 'landing',
        requestLinkId: link.id,
      });
      requestN += 1;
      requests.push({
        id: uid(K.request, requestN),
        eventId,
        fullName: guest.fullName,
        email: guest.email,
        phone: guest.phone,
        plusOnes,
        approvedPlusOnes: plusOnes,
        motivation: MOTIVATIONS[i % MOTIVATIONS.length],
        status: 'approved',
        decidedBy: link.autoApprove ? null : PEOPLE.robin.id,
        decidedVia: link.autoApprove ? 'auto' : 'manual',
        decisionReason: null,
        requestLinkId: link.id,
        marketingOptIn: i % 3 !== 1,
        minutesBeforeStart: 60 * 24 * 4 - i * 90,
      });
    }

    // Open and declined requests (no guest row).
    for (let i = 0; i < spec.pendingRequests + spec.deniedRequests; i++) {
      const pending = i < spec.pendingRequests;
      const { first, last } = nextName();
      const link = links[i % links.length];
      requestN += 1;
      requests.push({
        id: uid(K.request, requestN),
        eventId,
        fullName: `${first} ${last}`,
        email: i % 2 === 0 ? emailFor(first, last) : null,
        phone: i % 2 === 1 ? phoneFor(500 + requestN) : null,
        plusOnes: [1, 0, 2, 0, 1, 3][i % 6],
        approvedPlusOnes: null,
        motivation: MOTIVATIONS[(i + 1) % MOTIVATIONS.length],
        status: pending ? 'pending' : 'denied',
        decidedBy: pending ? null : PEOPLE.robin.id,
        decidedVia: 'manual',
        decisionReason: pending ? null : 'List is full tonight',
        requestLinkId: link.id,
        marketingOptIn: false,
        minutesBeforeStart: 60 * (30 - i * 4),
      });
    }

    // Heads-up notes on four guests.
    NOTES.forEach((n, i) => {
      const g = guests[REGULARS + 2 + i * 9];
      g.note = n.note;
      g.notePriority = n.priority;
    });

    // Removed (soft delete) and moved-up guests: Robin's later edits.
    const editable = guests.filter((g) => g.source === 'app' && g.addedBy !== PEOPLE.lotte.id);
    // Spread over the adders, not all from whoever was added last.
    const removals = Array.from({ length: spec.removed }, (_, i) =>
      editable[Math.floor(((i + 0.5) * editable.length) / spec.removed)].id,
    );
    const tierChanges = editable
      .filter((g) => g.tierId === tiers.guest.id && !removals.includes(g.id))
      .slice(0, 2)
      .map((g) => ({ guestId: g.id, tierId: tiers.vip.id }));

    // The door: check-ins and refusals (live + past only).
    const present = guests.filter((g) => !removals.includes(g.id));
    const checkInTarget = spec.checkIns < 1 ? Math.round(present.length * spec.checkIns) : spec.checkIns;
    const order = shuffled(present, rand);
    const arrivals = order.slice(0, checkInTarget);
    const refused = order.slice(checkInTarget, checkInTarget + spec.refusals);

    const doorWindow =
      spec.key === 'live'
        ? { from: minutesAfter(start, 8), to: minutesAfter(anchors.now, -3) }
        : { from: minutesAfter(start, 15), to: minutesAfter(start, 4 * 60 + 30) };
    const span = doorWindow.to.getTime() - doorWindow.from.getTime();
    // Arrivals as smooth quantiles, so the 15-minute chart reads clean: a live
    // night is still building (rising density), a past one peaked about a
    // third of the way in (triangular, mode 0.35 → ~00:45 for a 23:00 start).
    const MODE = 0.35;
    const curve = (q) =>
      spec.key === 'live' ? Math.sqrt(q) : q < MODE ? Math.sqrt(q * MODE) : 1 - Math.sqrt((1 - q) * (1 - MODE));
    const moments = arrivals.map((_, i) => new Date(doorWindow.from.getTime() + curve((i + 0.5) / arrivals.length) * span));

    const checkIns = arrivals.map((g, i) => {
      checkInN += 1;
      const at = moments[i];
      const offline = i % 17 === 5;
      return {
        id: uid(K.checkIn, checkInN),
        guestId: g.id,
        checkedBy: i % 3 === 2 ? PEOPLE.kai.id : PEOPLE.lotte.id,
        checkedAt: at,
        clientTimestamp: offline ? minutesAfter(at, -2) : at,
        deviceId: i % 3 === 2 ? 'door-ipad-kai' : 'door-iphone-lotte',
        // A few groups are still waiting on part of their party.
        plusOnesArrived: i % 6 === 4 ? Math.max(0, g.plusOnes - 1) : g.plusOnes,
        offlineSynced: offline,
      };
    });

    const refusals = refused.map((g, i) => {
      refusalN += 1;
      const at = new Date(doorWindow.from.getTime() + span * (0.35 + i * 0.15));
      return {
        id: uid(K.refusal, refusalN),
        guestId: g.id,
        refusedBy: PEOPLE.lotte.id,
        reason: REFUSAL_REASONS[i % REFUSAL_REASONS.length],
        refusedAt: at,
        deviceId: 'door-iphone-lotte',
      };
    });

    const quotaRequests = (spec.quotaRequests ?? []).map((q, i) => ({
      id: uid(K.quotaRequest, spec.n * 10 + i + 1),
      eventId,
      userId: PEOPLE[q.who].id,
      extra: q.extra,
      motivation: q.motivation,
    }));

    // Page views on each link for the days before the night (funnel step 1).
    const lastViewDay = spec.key === 'upcoming' ? anchors.now : start;
    const pageviews = links.flatMap((l) =>
      [6, 5, 4, 3, 2, 1, 0].map((daysBack) => ({
        linkId: l.id,
        day: minutesAfter(lastViewDay, -daysBack * 24 * 60).toISOString().slice(0, 10),
        // ~10 views per request over the week, rising toward the night.
        views: Math.round(l.share * spec.landing * (0.6 + (6 - daysBack) * 0.25)),
      })),
    );

    return {
      key: spec.key,
      id: eventId,
      name: spec.name,
      slug: spec.slug,
      startsAt: start,
      endsAt: end,
      // Live: auto-locked an hour in and locked by hand; past: locked at doors.
      autoLockAt: spec.key === 'upcoming' ? minutesAfter(start, -60) : minutesAfter(start, spec.key === 'live' ? 60 : 0),
      lock: spec.lock,
      tiers,
      links,
      guests,
      requests,
      removals,
      tierChanges,
      checkIns,
      refusals,
      quotaRequests,
      pageviews,
      organizer: spec.organizer > 0 || spec.key === 'live',
    };
  });

  return { venue: VENUE, people: PEOPLE, contacts, influencers, events };
}

// ── writing ──────────────────────────────────────────────────────────────────

const PROMOTER_AND_DOOR = [...PROMOTERS, 'kai', 'lotte'];

async function as(client, person) {
  const claims = person ? JSON.stringify({ sub: person.id, role: 'authenticated' }) : '';
  await client.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
    claims,
    person ? person.id : '',
  ]);
}

async function insertRows(client, table, rows, columns) {
  if (rows.length === 0) return;
  // ≤ 200 rows a statement keeps the parameter count far below Postgres' limit.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const params = [];
    const tuples = chunk.map((row) => {
      const slots = columns.map((c) => {
        params.push(row[c]);
        return `$${params.length}`;
      });
      return `(${slots.join(', ')})`;
    });
    await client.query(`insert into public.${table} (${columns.join(', ')}) values ${tuples.join(', ')}`, params);
  }
}

async function writePeople(client, data) {
  const people = Object.values(data.people);
  await as(client, null);
  for (const p of people) {
    await client.query(
      `insert into auth.users (
         instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
         confirmation_token, recovery_token, email_change, email_change_token_new,
         email_change_token_current, phone_change, phone_change_token, reauthentication_token)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, '', now(),
         '{"provider": "email", "providers": ["email"]}'::jsonb, jsonb_build_object('full_name', $3::text),
         now(), now(), '', '', '', '', '', '', '', '')`,
      [p.id, p.email, p.name],
    );
    await client.query(
      `insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
       values ($1::uuid, $1::uuid, jsonb_build_object('sub', $3::text, 'email', $2::text, 'email_verified', true), 'email', $3::text, now(), now(), now())`,
      [p.id, p.email, p.id],
    );
    const [first, ...rest] = p.name.split(' ');
    // Terms accepted, so the consent gate does not stand between a login and the app.
    await client.query(
      `insert into public.user_profiles (id, full_name, email, first_name, last_name, terms_accepted_at, terms_version)
       values ($1, $2, $3, $4, $5, now(), $6)`,
      [p.id, p.name, p.email, first, rest.join(' '), TERMS_VERSION],
    );
  }
}

async function writeVenue(client, data) {
  const v = data.venue;
  const { robin } = data.people;
  await as(client, robin);
  await client.query(
    `insert into public.venues
       (id, name, slug, retention_months, company_name, kvk_number, vat_number, finance_email,
        address_line, postal_code, city, country, default_personal_quota, settings,
        terms_accepted_at, terms_accepted_by, terms_version)
     values ($1, $2, $3, 12, $4, $5, $6, $7, $8, $9, $10, 'NL', 5, $11, now(), $12, $13)`,
    [
      v.id, v.name, v.slug, v.companyName, v.kvk, v.vat, v.financeEmail, v.address, v.postalCode, v.city,
      JSON.stringify({ venue_type: 'club', onboarding: { completed: true, created_by: robin.id } }),
      robin.id, TERMS_VERSION,
    ],
  );
  await client.query(`insert into public.subscriptions (venue_id, status, plan_id) values ($1, 'comped', 'pro')`, [v.id]);
  const members = Object.values(data.people).filter((p) => p.roles);
  await insertRows(
    client,
    'venue_memberships',
    members.map((p) => ({ venue_id: v.id, user_id: p.id, roles: p.roles, job_title: p.title })),
    ['venue_id', 'user_id', 'roles', 'job_title'],
  );
  await insertRows(
    client,
    'quotas',
    Object.entries(VENUE_QUOTA).map(([who, n]) => ({ venue_id: v.id, user_id: data.people[who].id, default_count: n })),
    ['venue_id', 'user_id', 'default_count'],
  );
  await insertRows(
    client,
    'contacts',
    data.contacts.map((c) => ({
      id: c.id, venue_id: v.id, full_name: c.fullName, email: c.email, phone: c.phone, birthdate: c.birthdate,
      preferred_role: c.preferredRole, is_permanent: c.isPermanent, source: c.source, created_by: robin.id,
    })),
    ['id', 'venue_id', 'full_name', 'email', 'phone', 'birthdate', 'preferred_role', 'is_permanent', 'source', 'created_by'],
  );
  await insertRows(
    client,
    'influencers',
    data.influencers.map((i) => ({ id: i.id, venue_id: v.id, name: i.name, handle: i.handle, user_id: i.userId, created_by: robin.id })),
    ['id', 'venue_id', 'name', 'handle', 'user_id', 'created_by'],
  );
}

async function writeEvent(client, data, ev) {
  const { robin } = data.people;
  const venueId = data.venue.id;
  await as(client, robin);
  await client.query(
    `insert into public.events
       (id, venue_id, name, starts_at, ends_at, status, landing_slug, landing_active, capacity, auto_lock_at)
     values ($1, $2, $3, $4, $5, 'open', $6, true, 300, $7)`,
    [ev.id, venueId, ev.name, ev.startsAt, ev.endsAt, ev.slug, ev.autoLockAt],
  );
  await insertRows(
    client,
    'guest_tiers',
    Object.values(ev.tiers).map((t) => ({
      id: t.id, event_id: ev.id, venue_id: venueId, name: t.name, color: t.color, aliases: t.aliases,
      door_price_cents: t.doorPriceCents,
      description: t.doorPriceCents ? '€17.50 at the door' : null,
    })),
    ['id', 'event_id', 'venue_id', 'name', 'color', 'aliases', 'door_price_cents', 'description'],
  );
  if (ev.organizer) {
    await client.query(`insert into public.event_organizers (event_id, user_id) values ($1, $2)`, [ev.id, data.people.jesse.id]);
  }
  await insertRows(
    client,
    'event_quotas',
    [
      ...PROMOTER_AND_DOOR.map((who) => ({ event_id: ev.id, user_id: data.people[who].id, quota_override: EVENT_QUOTA[who] })),
      ...(ev.organizer ? [{ event_id: ev.id, user_id: data.people.jesse.id, quota_override: ORGANIZER_QUOTA }] : []),
    ],
    ['event_id', 'user_id', 'quota_override'],
  );
  await insertRows(
    client,
    'request_links',
    ev.links.map((l) => ({
      id: l.id, event_id: ev.id, venue_id: venueId, influencer_id: l.influencerId, slug: l.slug,
      tier_id: l.tierId, auto_approve: l.autoApprove, created_by: robin.id,
    })),
    ['id', 'event_id', 'venue_id', 'influencer_id', 'slug', 'tier_id', 'auto_approve', 'created_by'],
  );

  // Guests, each batch written as the person who added it (audit actor).
  const byAdder = new Map();
  for (const g of ev.guests) {
    if (!byAdder.has(g.addedBy)) byAdder.set(g.addedBy, []);
    byAdder.get(g.addedBy).push(g);
  }
  for (const [adderId, rows] of byAdder) {
    await as(client, Object.values(data.people).find((p) => p.id === adderId));
    await insertRows(
      client,
      'guests',
      rows.map((g) => ({
        id: g.id, event_id: ev.id, tier_id: g.tierId, full_name: g.fullName, email: g.email, phone: g.phone,
        contact_id: g.contactId, plus_ones: g.plusOnes, note: g.note, note_priority: g.notePriority,
        added_by: g.addedBy, source: g.source, status: 'approved', request_link_id: g.requestLinkId,
      })),
      ['id', 'event_id', 'tier_id', 'full_name', 'email', 'phone', 'contact_id', 'plus_ones', 'note', 'note_priority',
        'added_by', 'source', 'status', 'request_link_id'],
    );
  }

  await as(client, robin);
  await insertRows(
    client,
    'guest_requests',
    ev.requests.map((r) => ({
      id: r.id, event_id: ev.id, venue_id: venueId, full_name: r.fullName, email: r.email, phone: r.phone,
      plus_ones: r.plusOnes, approved_plus_ones: r.approvedPlusOnes, motivation: r.motivation, status: r.status,
      decided_by: r.decidedBy,
      decided_at: r.status === 'pending' ? null : minutesAfter(ev.startsAt, -r.minutesBeforeStart + 20),
      decided_via: r.decidedVia, decision_reason: r.decisionReason, request_link_id: r.requestLinkId,
      marketing_opt_in: r.marketingOptIn,
      created_at: minutesAfter(ev.startsAt, -r.minutesBeforeStart),
    })),
    ['id', 'event_id', 'venue_id', 'full_name', 'email', 'phone', 'plus_ones', 'approved_plus_ones', 'motivation',
      'status', 'decided_by', 'decided_at', 'decided_via', 'decision_reason', 'request_link_id', 'marketing_opt_in',
      'created_at'],
  );

  // Robin's later edits: two guests moved up to VIP, a few taken off the list.
  for (const t of ev.tierChanges) {
    await client.query(`update public.guests set tier_id = $2 where id = $1`, [t.guestId, t.tierId]);
  }
  for (const id of ev.removals) {
    await client.query(`update public.guests set status = 'removed' where id = $1`, [id]);
  }

  // The door, as the door hosts.
  for (const host of [data.people.kai, data.people.lotte]) {
    await as(client, host);
    await insertRows(
      client,
      'check_ins',
      ev.checkIns
        .filter((c) => c.checkedBy === host.id)
        .map((c) => ({
          id: c.id, guest_id: c.guestId, checked_by: c.checkedBy, checked_at: c.checkedAt,
          client_timestamp: c.clientTimestamp, device_id: c.deviceId, plus_ones_arrived: c.plusOnesArrived,
          offline_synced: c.offlineSynced,
        })),
      ['id', 'guest_id', 'checked_by', 'checked_at', 'client_timestamp', 'device_id', 'plus_ones_arrived', 'offline_synced'],
    );
  }
  await as(client, data.people.lotte);
  await insertRows(
    client,
    'refusals',
    ev.refusals.map((r) => ({
      id: r.id, guest_id: r.guestId, refused_by: r.refusedBy, reason: r.reason, refused_at: r.refusedAt,
      client_timestamp: r.refusedAt, device_id: r.deviceId,
    })),
    ['id', 'guest_id', 'refused_by', 'reason', 'refused_at', 'client_timestamp', 'device_id'],
  );

  for (const q of ev.quotaRequests) {
    await as(client, Object.values(data.people).find((p) => p.id === q.userId));
    await client.query(
      `insert into public.quota_requests (id, event_id, venue_id, user_id, requested_extra, motivation) values ($1, $2, $3, $4, $5, $6)`,
      [q.id, ev.id, venueId, q.userId, q.extra, q.motivation],
    );
  }

  if (ev.lock) {
    await as(client, robin);
    await client.query(`update public.events set list_locked = true, locked_at = now(), locked_by = $2 where id = $1`, [ev.id, robin.id]);
  }

  await as(client, null);
  await insertRows(
    client,
    'request_link_pageviews_daily',
    ev.pageviews.filter((p) => p.views > 0).map((p) => ({ request_link_id: p.linkId, day: p.day, views: p.views })),
    ['request_link_id', 'day', 'views'],
  );
}

let TERMS_VERSION = '';

/** The legal version the consent gate expects, read from src/lib/legal.ts. */
function readTermsVersion() {
  const src = readFileSync(new URL('../src/lib/legal.ts', import.meta.url), 'utf8');
  const m = src.match(/export const TERMS_VERSION = '([^']+)'/);
  if (!m) throw new Error('promo seed: TERMS_VERSION not found in src/lib/legal.ts');
  return m[1];
}

async function anchors(client) {
  // Saturday 23:00 Amsterdam: the next one at least 36 h out, and the last one
  // at least 2 days back. The live night started at the top of the hour, 2 h ago.
  const { rows } = await client.query(`
    with l as (select (now() at time zone 'Europe/Amsterdam') as now_local),
    s as (select now_local, date_trunc('week', now_local) + interval '5 days 23 hours' as sat from l),
    u as (select now_local, case when sat < now_local + interval '36 hours' then sat + interval '7 days' else sat end as up from s),
    p as (select now_local, up,
            case when up - interval '7 days' > now_local - interval '2 days'
                 then up - interval '14 days' else up - interval '7 days' end as past from u)
    select now() as now,
           date_trunc('hour', now()) - interval '2 hours' as live_start,
           up at time zone 'Europe/Amsterdam' as upcoming_start,
           past at time zone 'Europe/Amsterdam' as past_start
    from p`);
  const r = rows[0];
  return { now: r.now, liveStart: r.live_start, upcomingStart: r.upcoming_start, pastStart: r.past_start };
}

async function main() {
  loadEnvLocal();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const dbUrl = process.env.PROMO_DB_URL ?? DEFAULT_DB_URL;
  if (!isLocalUrl(supabaseUrl) || !isLocalUrl(dbUrl)) {
    console.error(
      `promo seed: refusing to run — NEXT_PUBLIC_SUPABASE_URL (${supabaseUrl || 'unset'}) and the database URL must both be localhost. ` +
        'This script writes demo data and only ever runs against the local stack (pnpm supabase:start + pnpm dev:env).',
    );
    process.exit(1);
  }
  TERMS_VERSION = readTermsVersion();

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const existing = await client.query(
      `select e.name, e.starts_at <= now() and e.ends_at > now() as live
         from public.venues v left join public.events e on e.id = $2
        where v.id = $1`,
      [VENUE.id, uid(K.event, 1)],
    );
    if (existing.rowCount > 0) {
      const live = existing.rows[0].live;
      console.log(
        `promo seed: Kelder Nord already exists — nothing changed. ` +
          (live
            ? 'Velvet Hours is still live.'
            : 'Velvet Hours is no longer live; reset the stack (supabase db reset) and run pnpm promo:seed again for a fresh night.'),
      );
      return;
    }

    const data = buildPromoData(await anchors(client));
    await client.query('begin');
    await writePeople(client, data);
    await writeVenue(client, data);
    for (const ev of data.events) await writeEvent(client, data, ev);
    await client.query('commit');

    const port = process.env.PORT ?? '7000';
    console.log('promo seed: Kelder Nord ready.');
    for (const ev of data.events) {
      console.log(`  ${ev.name.padEnd(15)} ${ev.startsAt.toISOString()}  ${ev.guests.length} on the list, ${ev.checkIns.length} checked in`);
    }
    console.log(`  log in: http://localhost:${port}/auth/dev-login?email=${PEOPLE.robin.email}&next=/app`);
    console.log(`  others: ${Object.values(PEOPLE).filter((p) => p !== PEOPLE.robin).map((p) => p.email).join(', ')}`);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

// Run only when executed directly, so the unit test can import the plan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
