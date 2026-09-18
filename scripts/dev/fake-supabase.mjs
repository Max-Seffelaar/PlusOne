// Minimal fake Supabase (GoTrue + PostgREST) so the real Next app boots for
// screenshots without docker. Fixture-driven; unknown tables/RPCs return [].
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.FAKE_SUPABASE_PORT ?? 55421);
const APP_PORT = Number(process.env.PORT ?? 7100);
const now = Date.now();
const H = 3600_000,
  D = 24 * H;
const tonight = (() => {
  const d = new Date(now);
  d.setUTCHours(21, 0, 0, 0);
  return d.getTime();
})(); // 23:00 Amsterdam
const iso = (t) => new Date(t).toISOString();
const uid = () => randomUUID();

// ── users ──────────────────────────────────────────────────────────────────
const U1 = 'a0000000-0000-4000-8000-000000000001'; // manager (admin)
const U2 = 'a0000000-0000-4000-8000-000000000002'; // staff
const U3 = 'a0000000-0000-4000-8000-000000000003'; // door
const V1 = 'b0000000-0000-4000-8000-000000000001';
const E1 = 'c0000000-0000-4000-8000-000000000001';
const E2 = 'c0000000-0000-4000-8000-000000000002';
const E3 = 'c0000000-0000-4000-8000-000000000003';
const T = {}; // tiers by key

const users = {
  'manager@plusone.test': {
    id: U1,
    full_name: 'Max Seffelaar',
    first_name: 'Max',
    last_name: 'Seffelaar',
    roles: ['admin', 'user_manager'],
  },
  'staff@plusone.test': {
    id: U2,
    full_name: 'Sanne de Vries',
    first_name: 'Sanne',
    last_name: 'de Vries',
    roles: ['staff'],
  },
  'door@plusone.test': {
    id: U3,
    full_name: 'Daan Bakker',
    first_name: 'Daan',
    last_name: 'Bakker',
    roles: ['doorhost'],
  },
};

const db = {
  venues: [
    {
      id: V1,
      name: 'Club Nova',
      slug: 'club-nova',
      settings: {},
      allow_uncheck: true,
      default_personal_quota: 5,
      retention_months: 12,
      country: 'NL',
      company_name: 'Club Nova B.V.',
      kvk_number: null,
      vat_number: null,
      finance_email: null,
      address_line: 'Warmoesstraat 12',
      postal_code: '1012 JD',
      city: 'Amsterdam',
      created_at: iso(now - 90 * D),
      updated_at: iso(now),
      terms_accepted_at: iso(now - 90 * D),
      terms_version: '2026-06-24',
      terms_accepted_by: U1,
    },
  ],
  subscriptions: [
    {
      id: uid(),
      venue_id: V1,
      status: 'comped',
      plan_id: 'premium',
      current_period_end: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      created_at: iso(now - 90 * D),
      updated_at: iso(now),
      last_stripe_event_at: null,
    },
  ],
  user_profiles: Object.entries(users).map(([email, u]) => ({
    id: u.id,
    email,
    full_name: u.full_name,
    first_name: u.first_name,
    last_name: u.last_name,
    phone: null,
    mfa_snooze_until: null,
    terms_accepted_at: iso(now - 30 * D),
    terms_version: '2026-06-24',
    created_at: iso(now - 60 * D),
    updated_at: iso(now),
  })),
  venue_memberships: Object.values(users).map((u) => ({
    id: uid(),
    venue_id: V1,
    user_id: u.id,
    roles: u.roles,
    job_title: null,
    created_at: iso(now - 60 * D),
    updated_at: iso(now),
  })),
  events: [
    {
      id: E1,
      venue_id: V1,
      name: 'FRENZY',
      starts_at: iso(tonight),
      ends_at: iso(tonight + 6 * H),
      status: 'open',
      cancelled_at: null,
      list_locked: false,
      landing_active: true,
      landing_slug: 'frenzy',
      auto_lock_at: null,
      allow_uncheck: null,
      default_member_quota: 5,
      capacity: 400,
      locked_at: null,
      locked_by: null,
      went_live_at: null,
      created_at: iso(now - 10 * D),
      updated_at: iso(now),
    },
    {
      id: E2,
      venue_id: V1,
      name: 'Saturday Sessions',
      starts_at: iso(tonight + 9 * D),
      ends_at: iso(tonight + 9 * D + 6 * H),
      status: 'open',
      cancelled_at: null,
      list_locked: false,
      landing_active: true,
      landing_slug: 'saturday-sessions',
      auto_lock_at: null,
      allow_uncheck: null,
      default_member_quota: 5,
      capacity: 300,
      locked_at: null,
      locked_by: null,
      went_live_at: null,
      created_at: iso(now - 5 * D),
      updated_at: iso(now),
    },
    {
      id: E3,
      venue_id: V1,
      name: 'Opening Night',
      starts_at: iso(tonight - 6 * D),
      ends_at: iso(tonight - 6 * D + 6 * H),
      status: 'closed',
      cancelled_at: null,
      list_locked: true,
      landing_active: false,
      landing_slug: 'opening-night',
      auto_lock_at: null,
      allow_uncheck: null,
      default_member_quota: 5,
      capacity: 300,
      locked_at: iso(now - 6 * D),
      locked_by: U1,
      went_live_at: iso(now - 6 * D),
      created_at: iso(now - 20 * D),
      updated_at: iso(now),
    },
  ],
  guest_tiers: [],
  guests: [],
  check_ins: [],
  request_links: [],
  contacts: [],
  event_organizers: [],
  invites: [],
  quotas: [
    {
      id: uid(),
      venue_id: V1,
      user_id: U2,
      default_count: 5,
      created_at: iso(now),
      updated_at: iso(now),
    },
  ],
  event_quotas: [],
  guest_requests: [],
  quota_requests: [],
  refusals: [],
  influencers: [],
  event_templates: [],
  event_template_tiers: [],
  audit_feed: [],
};

function tier(eventId, key, name, color, max, aliases, price) {
  const id = uid();
  T[`${eventId}:${key}`] = id;
  db.guest_tiers.push({
    id,
    event_id: eventId,
    venue_id: V1,
    name,
    color,
    max_guests: max,
    aliases,
    door_price_cents: price,
    vat_percent: price ? 21 : null,
    description: null,
    created_at: iso(now - 9 * D),
    updated_at: iso(now),
  });
  return id;
}
for (const ev of [E1, E2, E3]) {
  tier(ev, 'guest', 'Guest', '#B5A6FF', 150, ['gl', 'guestlist'], 1000);
  tier(ev, 'vip', 'VIP', '#9DE0C0', 40, ['vip'], null);
  tier(ev, 'backstage', 'Backstage', '#E8C98A', 20, ['backstage', 'bs', 'prod'], null);
}

const names = [
  'Lotte Jansen',
  'Noah de Boer',
  'Emma Visser',
  'Liam Smit',
  'Julia Mulder',
  'Sem Bos',
  'Mila Vos',
  'Lucas Peters',
  'Tess Hendriks',
  'Finn Dekker',
  'Sara Kok',
  'Daan van Dijk',
  'Eva Meijer',
  'Milan Brouwer',
  'Zoë de Groot',
  'Bram Willems',
  'Nina Dijkstra',
  'Jesse Smits',
  'Fleur de Jong',
  'Thijs Vermeulen',
];
let gi = 0;
function guest(eventId, name, tierKey, plus, status, source, addedBy, opts = {}) {
  const id = `d0000000-0000-4000-8000-${String(++gi).padStart(12, '0')}`;
  const contactId = opts.contactId ?? null;
  db.guests.push({
    id,
    event_id: eventId,
    venue_id: V1,
    full_name: name,
    plus_ones: plus,
    status,
    source,
    tier_id: T[`${eventId}:${tierKey}`],
    note: opts.note ?? null,
    note_priority: opts.notePriority ?? 'none',
    note_acknowledged_at: null,
    note_acknowledged_by: null,
    email: opts.email ?? null,
    phone: opts.phone ?? null,
    contact_id: contactId,
    added_by: addedBy,
    request_link_id: opts.linkId ?? null,
    removed_at: null,
    anonymized_at: null,
    created_at: iso(now - (20 - gi) * H),
    updated_at: iso(now),
  });
  return id;
}
function checkin(eventId, guestId, plusArrived, minutesAgo, by = U3) {
  db.check_ins.push({
    id: uid(),
    event_id: eventId,
    venue_id: V1,
    guest_id: guestId,
    checked_by: by,
    plus_ones_arrived: plusArrived,
    checked_at: iso(now - minutesAgo * 60_000),
    client_timestamp: null,
    device_id: null,
    offline_synced: false,
    synced_by: null,
    voided_at: null,
    voided_by: null,
    created_at: iso(now - minutesAgo * 60_000),
  });
}
// contacts
const C1 = uid(),
  C2 = uid(),
  C3 = uid();
db.contacts.push(
  {
    id: C1,
    venue_id: V1,
    full_name: 'Lotte Jansen',
    email: 'lotte@example.com',
    email_norm: 'lotte@example.com',
    phone: '+31612345678',
    phone_norm: '+31612345678',
    birthdate: null,
    preferred_role: 'vip',
    note: null,
    is_permanent: false,
    source: 'import',
    created_by: U1,
    anonymized_at: null,
    created_at: iso(now - 40 * D),
    updated_at: iso(now),
  },
  {
    id: C2,
    venue_id: V1,
    full_name: 'Noah de Boer',
    email: null,
    email_norm: null,
    phone: null,
    phone_norm: null,
    birthdate: null,
    preferred_role: 'guest',
    note: null,
    is_permanent: false,
    source: 'guest_list',
    created_by: U2,
    anonymized_at: null,
    created_at: iso(now - 30 * D),
    updated_at: iso(now),
  },
  {
    id: C3,
    venue_id: V1,
    full_name: 'Emma Visser',
    email: 'emma@example.com',
    email_norm: 'emma@example.com',
    phone: null,
    phone_norm: null,
    birthdate: null,
    preferred_role: 'all_access',
    note: 'Photographer',
    is_permanent: true,
    source: 'manual',
    created_by: U1,
    anonymized_at: null,
    created_at: iso(now - 20 * D),
    updated_at: iso(now),
  }
);
// E1 guests (tonight)
const L1 = uid();
db.request_links.push({
  id: L1,
  event_id: E1,
  venue_id: V1,
  slug: 'frenzy',
  is_default: true,
  label: null,
  influencer_id: null,
  active: true,
  auto_approve: false,
  max_headcount: null,
  tier_id: null,
  expires_at: null,
  archived_at: null,
  created_by: U1,
  created_at: iso(now - 10 * D),
  updated_at: iso(now),
});
db.request_links.push({
  id: uid(),
  event_id: E2,
  venue_id: V1,
  slug: 'saturday-sessions',
  is_default: true,
  label: null,
  influencer_id: null,
  active: true,
  auto_approve: false,
  max_headcount: null,
  tier_id: null,
  expires_at: null,
  archived_at: null,
  created_by: U1,
  created_at: iso(now - 5 * D),
  updated_at: iso(now),
});
const g = [];
g.push(
  guest(E1, names[0], 'vip', 1, 'approved', 'app', U1, {
    contactId: C1,
    email: 'lotte@example.com',
  })
);
g.push(guest(E1, names[1], 'guest', 0, 'approved', 'app', U2, { contactId: C2 }));
g.push(
  guest(E1, names[2], 'backstage', 0, 'approved', 'app', U1, {
    contactId: C3,
    note: 'Photographer, needs wristband',
    notePriority: 'high',
  })
);
g.push(
  guest(E1, names[3], 'guest', 2, 'approved', 'landing', null, {
    linkId: L1,
    email: 'liam@example.com',
  })
);
g.push(guest(E1, names[4], 'guest', 1, 'approved', 'landing', null, { linkId: L1 }));
g.push(guest(E1, names[5], 'vip', 3, 'approved', 'app', U1));
g.push(guest(E1, names[6], 'guest', 0, 'approved', 'door', U3));
g.push(guest(E1, names[7], 'guest', 1, 'approved', 'app', U2));
g.push(guest(E1, names[8], 'backstage', 0, 'approved', 'permanent', U1));
g.push(guest(E1, names[9], 'guest', 0, 'refused', 'app', U2));
g.push(guest(E1, names[10], 'vip', 1, 'approved', 'app', U1));
g.push(guest(E1, names[11], 'guest', 2, 'approved', 'landing', null, { linkId: L1 }));
for (let i = 12; i < 20; i++)
  g.push(
    guest(E1, names[i], i % 3 === 0 ? 'vip' : 'guest', i % 3, 'approved', 'app', i % 2 ? U1 : U2)
  );
checkin(E1, g[0], 1, 12);
checkin(E1, g[2], 0, 30);
checkin(E1, g[6], 0, 5);
for (const id of [g[0], g[2], g[6]]) db.guests.find((x) => x.id === id).status = 'checked_in';
// E2 guests
guest(E2, names[12], 'guest', 1, 'approved', 'app', U1);
guest(E2, names[13], 'vip', 0, 'approved', 'app', U2);
guest(E2, names[14], 'guest', 2, 'approved', 'landing', null);
// E3 past
const p = [];
for (let i = 0; i < 10; i++)
  p.push(guest(E3, names[i], i % 4 === 0 ? 'vip' : 'guest', i % 2, 'approved', 'app', U1));
for (let i = 0; i < 7; i++) {
  checkin(E3, p[i], i % 2, 6 * 24 * 60 - i * 10);
  db.guests.find((x) => x.id === p[i]).status = 'checked_in';
}
// requests
db.guest_requests.push({
  id: uid(),
  event_id: E1,
  venue_id: V1,
  request_link_id: L1,
  full_name: 'Rosa Kuipers',
  email: 'rosa@example.com',
  phone: null,
  plus_ones: 1,
  status: 'pending',
  decided_at: null,
  decided_by: null,
  decision_source: null,
  note: 'Friend of the promoter',
  created_at: iso(now - 3 * H),
  updated_at: iso(now),
});
// A big party on next week's event: the partial-approval stepper (approve +2 of +4).
db.guest_requests.push({
  id: uid(),
  event_id: E2,
  venue_id: V1,
  request_link_id: null,
  full_name: 'Mila Jansen',
  email: 'mila@example.com',
  phone: '+31612345678',
  plus_ones: 4,
  motivation: 'Birthday, coming with my sisters',
  status: 'pending',
  decided_at: null,
  decided_by: null,
  decided_via: 'manual',
  decision_reason: null,
  approved_plus_ones: null,
  decision_message: null,
  created_at: iso(now - 5 * H),
  updated_at: iso(now),
});

// Status-page fixtures (/r/[token]). The page looks the token up by sha256, so
// these are keyed the same way. Same gating as get_request_status: the venue
// address, confirmed count + message only on `approved`, and never for a
// mirror (a duplicate submission's token).
const statusFixtures = {
  'demo-pending': { event: E2, status: 'pending', full_name: 'Mila Jansen', plus_ones: 4 },
  'demo-approved': { event: E1, status: 'approved', full_name: 'Liam Smit', plus_ones: 2 },
  'demo-reduced': {
    event: E2,
    status: 'approved',
    full_name: 'Mila Jansen',
    plus_ones: 4,
    approved_plus_ones: 2,
    decision_message: 'Happy birthday! We could fit three of you. Doors close at 01:00, so come on time.',
  },
  'demo-denied': { event: E1, status: 'denied', full_name: 'Sem de Boer', plus_ones: 1 },
  // A duplicate submission's token whose original request was approved.
  'demo-mirror': { event: E2, status: 'approved', full_name: 'Sid de Vries', plus_ones: 4, mirror: true },
};
const statusByHash = new Map(
  Object.entries(statusFixtures).map(([tok, f]) => [
    createHash('sha256').update(tok).digest('hex'),
    f,
  ])
);

// ── helpers ────────────────────────────────────────────────────────────────
const FK = {
  venues: 'venue_id',
  guests: 'guest_id',
  user_profiles: 'user_id',
  events: 'event_id',
  guest_tiers: 'tier_id',
  contacts: 'contact_id',
  influencers: 'influencer_id',
  request_links: 'request_link_id',
};
const REVERSE_ONE = new Set(['subscriptions']);

function parseSelect(sel) {
  // returns array of {name, alias, table, hint, inner, children}
  const out = [];
  let depth = 0,
    cur = '';
  const parts = [];
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  for (let part of parts) {
    part = part.trim();
    if (!part) continue;
    const m = part.match(/^(?:([a-z_]+):)?([a-z_]+)(!([a-z_]+))?\((.*)\)$/s);
    if (m) {
      const [, alias, table, , hint, inner] = m;
      out.push({
        kind: 'embed',
        alias: alias ?? table,
        table,
        hint,
        inner: hint === 'inner',
        children: parseSelect(inner),
      });
    } else {
      const m2 = part.match(/^(?:([a-z_]+):)?([a-z_*]+)/);
      out.push({ kind: 'col', alias: m2[1] ?? m2[2], name: m2[2] });
    }
  }
  return out;
}

function singular(t) {
  return t.endsWith('ies') ? t.slice(0, -3) + 'y' : t.endsWith('s') ? t.slice(0, -1) : t;
}

function embedRows(parentTable, row, node) {
  const target = db[node.table] ?? [];
  let col = null;
  if (node.hint && node.hint.endsWith('_fkey')) {
    col = node.hint.replace(`${parentTable}_`, '').replace(/_fkey$/, '');
  } else if (FK[node.table] && FK[node.table] in row) col = FK[node.table];
  if (col) {
    const hit = target.find((r) => r.id === row[col]);
    return { one: true, rows: hit ? [hit] : [] };
  }
  // reverse: rows in target whose FK points at this row
  const back = FK[parentTable] ?? `${singular(parentTable)}_id`;
  const rows = target.filter((r) => r[back] === row.id);
  return { one: REVERSE_ONE.has(node.table), rows };
}

function project(table, row, nodes) {
  const out = {};
  for (const n of nodes) {
    if (n.kind === 'col') {
      if (n.name === '*') Object.assign(out, row);
      else out[n.alias] = row[n.name] ?? null;
    } else {
      const { one, rows } = embedRows(table, row, n);
      const proj = rows.map((r) => project(n.table, r, n.children));
      out[n.alias] = one ? (proj[0] ?? null) : proj;
    }
  }
  return out;
}

function parseVal(v) {
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}
function matches(row, op, val) {
  const cmp = (a, b) => (a == null ? -1 : a < b ? -1 : a > b ? 1 : 0);
  switch (op) {
    case 'eq':
      return String(row) === String(val);
    case 'neq':
      return String(row) !== String(val);
    case 'is':
      return parseVal(val) === null ? row == null : row === parseVal(val);
    case 'gt':
      return cmp(row, val) > 0;
    case 'gte':
      return cmp(row, val) >= 0;
    case 'lt':
      return cmp(row, val) < 0;
    case 'lte':
      return cmp(row, val) <= 0;
    case 'in': {
      const list = val
        .replace(/^\(|\)$/g, '')
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''));
      return list.includes(String(row));
    }
    case 'ilike': {
      const re = new RegExp(
        '^' +
          val
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/%/g, '.*')
            .replace(/_/g, '.') +
          '$',
        'i'
      );
      return re.test(String(row ?? ''));
    }
    case 'like': {
      const re = new RegExp(
        '^' + val.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'
      );
      return re.test(String(row ?? ''));
    }
    case 'cs':
    case 'ov':
    case 'fts':
    case 'plfts':
      return true;
    default:
      return true;
  }
}

function applyFilters(table, rows, nodes, params) {
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'or', 'and', 'on_conflict', 'columns'].includes(key))
      continue;
    const m = raw.match(/^(not\.)?([a-z]+)\.(.*)$/s);
    if (!m) continue;
    const [, neg, op, val] = m;
    if (key.includes('.')) {
      // embedded filter: parent must have ≥1 embedded row matching (inner semantics)
      const [emb, col] = key.split('.');
      const node = nodes.find((n) => n.kind === 'embed' && n.alias === emb);
      if (!node) continue;
      rows = rows.filter((r) =>
        embedRows(table, r, node).rows.some((e) => matches(e[col], op, val) !== Boolean(neg))
      );
    } else {
      rows = rows.filter((r) => matches(r[key], op, val) !== Boolean(neg));
    }
  }
  // inner embeds require ≥1 row
  for (const n of nodes)
    if (n.kind === 'embed' && n.inner)
      rows = rows.filter((r) => embedRows(table, r, n).rows.length > 0);
  return rows;
}

function applyOrder(rows, order) {
  if (!order) return rows;
  const keys = order.split(',').map((o) => {
    const [col, ...f] = o.split('.');
    return { col, desc: f.includes('desc') };
  });
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const c = a[k.col] < b[k.col] ? -1 : a[k.col] > b[k.col] ? 1 : 0;
      if (c) return k.desc ? -c : c;
    }
    return 0;
  });
}

// ── RPCs ───────────────────────────────────────────────────────────────────
const inside = (eventId) => db.check_ins.filter((c) => c.event_id === eventId && !c.voided_at);
const rpcs = {
  current_user_requires_mfa: () => false,
  accept_pending_invites: () => null,
  list_own_sessions: () => [
    {
      session_id: uid(),
      aal: 'aal1',
      created_at: iso(now - D),
      updated_at: iso(now),
      ip: '10.0.0.1',
      is_current: true,
      not_after: iso(now + 30 * D),
      user_agent: 'Chrome · macOS',
    },
  ],
  venue_event_headcounts: ({ p_venue_id }) =>
    db.events
      .filter((e) => e.venue_id === p_venue_id)
      .map((e) => {
        const gs = db.guests.filter(
          (x) => x.event_id === e.id && ['approved', 'checked_in'].includes(x.status)
        );
        const ci = inside(e.id);
        return {
          event_id: e.id,
          registered: gs.reduce((s, x) => s + 1 + x.plus_ones, 0),
          present: ci.reduce((s, c) => s + 1 + c.plus_ones_arrived, 0),
        };
      }),
  event_quota_status: () => [{ quota: 5, consumed: 2, remaining: 3, exempt: false }],
  event_tier_occupancy: ({ p_event_id }) =>
    db.guest_tiers
      .filter((t) => t.event_id === p_event_id)
      .map((t) => ({
        tier_id: t.id,
        used: db.guests
          .filter(
            (x) =>
              x.event_id === p_event_id &&
              x.tier_id === t.id &&
              x.status !== 'removed' &&
              x.status !== 'refused'
          )
          .reduce((s, x) => s + 1 + x.plus_ones, 0),
      })),
  event_stats_summary: ({ p_event_id }) => {
    const gs = db.guests.filter(
      (x) => x.event_id === p_event_id && ['approved', 'checked_in'].includes(x.status)
    );
    const ci = inside(p_event_id);
    return [
      {
        registered: gs.length,
        registered_headcount: gs.reduce((s, x) => s + 1 + x.plus_ones, 0),
        present: ci.length,
        present_headcount: ci.reduce((s, c) => s + 1 + c.plus_ones_arrived, 0),
        no_shows: gs.length - ci.length,
        refused: 0,
        attendance_pct: Math.round((ci.length / Math.max(1, gs.length)) * 100),
        peak_bucket: iso(now - 6 * D + 2 * H),
        peak_count: 4,
      },
    ];
  },
  event_tier_stats: ({ p_event_id }) =>
    db.guest_tiers
      .filter((t) => t.event_id === p_event_id)
      .map((t) => {
        const gs = db.guests.filter(
          (x) =>
            x.event_id === p_event_id &&
            x.tier_id === t.id &&
            ['approved', 'checked_in'].includes(x.status)
        );
        const ci = inside(p_event_id).filter((c) => gs.some((x) => x.id === c.guest_id));
        return {
          tier_id: t.id,
          tier_name: t.name,
          color: t.color,
          registered: gs.length,
          registered_headcount: gs.reduce((s, x) => s + 1 + x.plus_ones, 0),
          present: ci.length,
          present_headcount: ci.reduce((s, c) => s + 1 + c.plus_ones_arrived, 0),
        };
      }),
  event_link_funnel: ({ p_event_id }) =>
    db.request_links
      .filter((l) => l.event_id === p_event_id)
      .map((l) => ({
        link_id: l.id,
        slug: l.slug,
        is_default: l.is_default,
        label: l.label,
        influencer_id: l.influencer_id,
        influencer_name: null,
        active: l.active,
        auto_approve: l.auto_approve,
        max_headcount: l.max_headcount,
        tier_id: l.tier_id,
        expires_at: l.expires_at,
        created_at: l.created_at,
        views: 38,
        requests: 4,
        approved: 3,
        approved_heads: 7,
        checked_in_heads: 2,
      })),
  find_event_guest_by_name: ({ p_event_id, p_name }) =>
    db.guests
      .filter(
        (x) =>
          x.event_id === p_event_id &&
          x.full_name.toLowerCase() === String(p_name ?? '').toLowerCase()
      )
      .map((x) => ({ id: x.id, full_name: x.full_name, plus_ones: x.plus_ones })),
  find_event_guests_by_names: () => [],
  get_request_status: ({ p_token_hash }) => {
    const f = statusByHash.get(p_token_hash);
    const e = f && db.events.find((x) => x.id === f.event);
    if (!f || !e) return { found: false };
    const v = db.venues.find((x) => x.id === e.venue_id);
    const approved = f.status === 'approved';
    const own = approved && !f.mirror;
    return {
      found: true,
      status: f.status,
      full_name: f.full_name,
      plus_ones: f.plus_ones,
      event_name: e.name,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      approved_plus_ones: own ? (f.approved_plus_ones ?? f.plus_ones) : null,
      decision_message: own ? (f.decision_message ?? null) : null,
      venue_address_line: own ? (v?.address_line ?? null) : null,
      venue_postal_code: own ? (v?.postal_code ?? null) : null,
      venue_city: own ? (v?.city ?? null) : null,
    };
  },
  // In-memory approval: the request leaves the inbox, the guest lands with the
  // APPROVED plus-ones (no tier-max/capacity checks here, the harness has no RLS).
  approve_guest_request: ({ p_request_id, p_tier_id, p_plus_ones, p_message }, email) => {
    const r = db.guest_requests.find((x) => x.id === p_request_id);
    if (!r) return null;
    const plus = p_plus_ones ?? r.plus_ones;
    Object.assign(r, {
      status: 'approved',
      decided_at: iso(Date.now()),
      decided_by: users[email]?.id ?? null,
      decided_via: 'manual',
      decision_reason: null,
      approved_plus_ones: plus,
      decision_message: p_message ?? null,
    });
    const id = uid();
    db.guests.push({
      ...db.guests.find((x) => x.event_id === r.event_id),
      id,
      event_id: r.event_id,
      tier_id: p_tier_id,
      full_name: r.full_name,
      email: r.email,
      phone: r.phone,
      plus_ones: plus,
      status: 'approved',
      source: 'landing',
      added_by: users[email]?.id ?? null,
      request_link_id: r.request_link_id,
      created_at: iso(Date.now()),
      updated_at: iso(Date.now()),
    });
    // send() writes strings raw, so hand it the JSON encoding of the uuid.
    return JSON.stringify(id);
  },
};

// ── auth ───────────────────────────────────────────────────────────────────
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function authUser(email) {
  const u = users[email];
  const t = iso(now);
  return {
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: t,
    phone: '',
    confirmed_at: t,
    last_sign_in_at: t,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    factors: [],
    created_at: t,
    updated_at: t,
    is_anonymous: false,
  };
}
function jwt(email) {
  const u = users[email];
  const exp = Math.floor(now / 1000) + 30 * 86400;
  return `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ iss: `http://127.0.0.1:${PORT}/auth/v1`, sub: u.id, aud: 'authenticated', exp, iat: Math.floor(now / 1000), email, phone: '', app_metadata: { provider: 'email' }, user_metadata: {}, role: 'authenticated', aal: 'aal1', amr: [{ method: 'otp', timestamp: Math.floor(now / 1000) }], session_id: uid(), is_anonymous: false })}.sig`;
}
const tokens = new Map(); // access_token → email
function session(email) {
  const at = jwt(email);
  tokens.set(at, email);
  return {
    access_token: at,
    token_type: 'bearer',
    expires_in: 30 * 86400,
    expires_at: Math.floor(now / 1000) + 30 * 86400,
    refresh_token: 'rt-' + email,
    user: authUser(email),
  };
}
const pendingLinks = new Map();

function whoami(req) {
  const a = req.headers.authorization ?? '';
  const t = a.replace(/^Bearer /, '');
  const email = tokens.get(t);
  if (email) return email;
  try {
    const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
    return p.email;
  } catch {
    return null;
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
  'Access-Control-Expose-Headers': 'Content-Range, X-Supabase-Api-Version',
};

function send(res, status, body, extra = {}) {
  const h = { 'Content-Type': 'application/json', ...CORS, ...extra };
  res.writeHead(status, h);
  res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let raw = '';
  for await (const c of req) raw += c;
  const body = raw
    ? (() => {
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      })()
    : null;
  const log = (extra = '') =>
    console.log(`${req.method} ${url.pathname}${url.search.slice(0, 160)} ${extra}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  // ── GoTrue ──
  if (url.pathname.startsWith('/auth/v1/')) {
    const p = url.pathname.slice('/auth/v1/'.length);
    log();
    if (p === 'admin/generate_link') {
      const email = body.email;
      if (!users[email]) return send(res, 404, { msg: 'user not found' });
      const hashed = 'hash-' + uid();
      pendingLinks.set(hashed, email);
      return send(res, 200, {
        ...authUser(email),
        action_link: 'x',
        email_otp: '123456',
        hashed_token: hashed,
        redirect_to: 'x',
        verification_type: 'magiclink',
      });
    }
    if (p === 'admin/users' && req.method === 'POST') {
      return send(res, 200, authUser(body.email));
    }
    if (p === 'verify') {
      const email = pendingLinks.get(body.token_hash);
      if (!email) return send(res, 401, { error: 'bad token' });
      return send(res, 200, session(email));
    }
    if (p === 'token') {
      const email = String(body?.refresh_token ?? '').replace(/^rt-/, '');
      if (!users[email]) return send(res, 401, { error: 'invalid refresh' });
      return send(res, 200, session(email));
    }
    if (p === 'user') {
      const email = whoami(req);
      if (!email || !users[email]) return send(res, 401, { msg: 'invalid JWT', code: 401 });
      return send(res, 200, authUser(email));
    }
    if (p === 'logout') {
      return send(res, 204);
    }
    if (p === 'factors') return send(res, 200, []);
    return send(res, 200, {});
  }

  // ── PostgREST ──
  if (url.pathname.startsWith('/rest/v1/')) {
    const p = url.pathname.slice('/rest/v1/'.length);
    const email = whoami(req);
    if (p.startsWith('rpc/')) {
      const fn = p.slice(4);
      const args = req.method === 'GET' ? Object.fromEntries(url.searchParams) : (body ?? {});
      const impl = rpcs[fn];
      const out = impl ? impl(args, email) : [];
      log(`→ rpc ${impl ? 'ok' : 'UNKNOWN'}`);
      const single = (req.headers.accept ?? '').includes('object');
      if (single && Array.isArray(out)) {
        if (out.length === 0)
          return send(res, 406, {
            code: 'PGRST116',
            details: '0 rows',
            hint: null,
            message: 'JSON object requested, multiple (or no) rows returned',
          });
        return send(res, 200, out[0]);
      }
      return send(res, 200, out);
    }
    const table = p;
    const nodes = parseSelect(url.searchParams.get('select') ?? '*');
    const params = [...url.searchParams.entries()];
    const single = (req.headers.accept ?? '').includes('object');
    const prefer = req.headers.prefer ?? '';
    if (req.method === 'POST') {
      const rows = (Array.isArray(body) ? body : [body]).map((r) => ({
        id: uid(),
        created_at: iso(Date.now()),
        updated_at: iso(Date.now()),
        ...r,
      }));
      (db[table] ??= []).push(...rows);
      log(`→ insert ${rows.length}`);
      const out = rows.map((r) => project(table, r, nodes));
      return send(
        res,
        201,
        prefer.includes('representation') ? (single ? out[0] : out) : undefined
      );
    }
    if (req.method === 'PATCH') {
      let rows = applyFilters(table, db[table] ?? [], nodes, params);
      for (const r of rows) Object.assign(r, body);
      log(`→ update ${rows.length}`);
      const out = rows.map((r) => project(table, r, nodes));
      return send(
        res,
        200,
        prefer.includes('representation') ? (single ? out[0] : out) : undefined
      );
    }
    if (req.method === 'DELETE') {
      return send(res, 200, []);
    }
    let rows = applyFilters(table, db[table] ?? [], nodes, params);
    rows = applyOrder(rows, url.searchParams.get('order'));
    const total = rows.length;
    let from = 0,
      to = rows.length - 1;
    const range = req.headers.range;
    if (range) {
      const [a, b] = range.split('-').map(Number);
      from = a;
      to = Number.isFinite(b) ? b : to;
    }
    if (url.searchParams.has('offset')) from = Number(url.searchParams.get('offset'));
    if (url.searchParams.has('limit')) to = from + Number(url.searchParams.get('limit')) - 1;
    rows = rows.slice(from, to + 1);
    const out = rows.map((r) => project(table, r, nodes));
    const extra = {};
    if (prefer.includes('count='))
      extra['Content-Range'] = `${from}-${from + out.length - 1}/${total}`;
    log(`→ ${db[table] ? '' : 'UNKNOWN TABLE '}${out.length}/${total}`);
    if (req.method === 'HEAD') {
      res.writeHead(200, { ...CORS, ...extra });
      return res.end();
    }
    if (single) {
      if (out.length === 0)
        return send(
          res,
          406,
          {
            code: 'PGRST116',
            details: 'The result contains 0 rows',
            hint: null,
            message: 'JSON object requested, multiple (or no) rows returned',
          },
          extra
        );
      return send(res, 200, out[0], extra);
    }
    return send(res, 200, out, extra);
  }
  if (url.pathname.startsWith('/realtime/')) {
    res.writeHead(404, CORS);
    return res.end();
  }
  log('?? unhandled');
  send(res, 404, { error: 'nope' });
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[fake-supabase] listening on http://127.0.0.1:${PORT}`);
  if (!process.argv.includes('--serve')) return;
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PORT}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fake-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key',
    NEXT_PUBLIC_APP_URL: `http://localhost:${APP_PORT}`,
    PORT: String(APP_PORT),
  };
  console.log(
    `[fake-supabase] starting next dev on http://localhost:${APP_PORT} (fixtures, no RLS)`
  );
  for (const email of Object.keys(users)) {
    console.log(
      `  http://localhost:${APP_PORT}/auth/dev-login?email=${encodeURIComponent(email)}&next=/app`
    );
  }
  const child = spawn('npx', ['next', 'dev', '-p', String(APP_PORT)], {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => {
    server.close();
    process.exit(code ?? 0);
  });
});
