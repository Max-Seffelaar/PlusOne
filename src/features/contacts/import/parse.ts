import type { ContactRole } from '../schemas';

// Pure, deterministic parsing + normalisation for the address-book import (#10):
// paste lists and CSV files → ParsedContact rows, with intra-file dedupe. These
// run client-side for the live preview ("BESTAAT AL" / "NIEUW"); the DB unique
// indexes + upsert_contacts RPC remain the race-proof authority. The normalisers
// MUST match the DB exactly (contacts.email_norm / phone_norm) so the preview's
// dedup decision agrees with what the import actually does.

export interface ParsedContact {
  fullName: string;
  email?: string;
  phone?: string;
  /** ISO yyyy-mm-dd. */
  birthdate?: string;
  preferredRole?: ContactRole;
}

/** lower + trim, '' → null. Mirrors contacts.email_norm. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim().toLowerCase();
  return t === '' ? null : t;
}

/** Strip every non-digit, '' → null. Mirrors contacts.phone_norm regexp_replace([^0-9]). */
export function normalizePhoneToDigits(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  return digits === '' ? null : digits;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Looks like an e-mail (for headerless column classification). */
function looksLikeEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

/** Looks like a phone: ≥6 digits and only phone-ish characters. */
function looksLikePhone(s: string): boolean {
  const t = s.trim();
  return /[0-9]/.test(t) && /^[+()\-\s./0-9]+$/.test(t) && (t.match(/[0-9]/g)?.length ?? 0) >= 6;
}

const ROLE_ALIASES: Record<string, ContactRole> = {
  vip: 'vip',
  'all access': 'all_access',
  allaccess: 'all_access',
  aa: 'all_access',
  all_access: 'all_access',
  backstage: 'all_access',
  artist: 'artist',
  artiest: 'artist',
  dj: 'artist',
  pers: 'press',
  press: 'press',
  media: 'press',
  crew: 'crew',
  productie: 'crew',
  staff: 'crew',
  gast: 'guest',
  guest: 'guest',
  regular: 'guest',
  normaal: 'guest',
};

/** Map a free-text role token to a ContactRole, or undefined. */
export function mapRole(raw: string | null | undefined): ContactRole | undefined {
  const t = (raw ?? '').trim().toLowerCase();
  return t ? ROLE_ALIASES[t] : undefined;
}

/** yyyy-mm-dd or dd-mm-yyyy / dd/mm/yyyy → ISO yyyy-mm-dd, else undefined. */
export function parseDate(raw: string | null | undefined): string | undefined {
  const t = (raw ?? '').trim();
  if (!t) return undefined;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    return `${m[3]}-${mo}-${d}`;
  }
  return undefined;
}

// ── Header mapping ──────────────────────────────────────────────────────────

type Field = 'fullName' | 'email' | 'phone' | 'birthdate' | 'preferredRole';

const HEADER_ALIASES: Record<string, Field> = {
  naam: 'fullName',
  name: 'fullName',
  volledige_naam: 'fullName',
  'volledige naam': 'fullName',
  full_name: 'fullName',
  fullname: 'fullName',
  contact: 'fullName',
  email: 'email',
  'e-mail': 'email',
  mail: 'email',
  emailadres: 'email',
  telefoon: 'phone',
  tel: 'phone',
  phone: 'phone',
  mobiel: 'phone',
  gsm: 'phone',
  nummer: 'phone',
  geboortedatum: 'birthdate',
  geboorte: 'birthdate',
  birthdate: 'birthdate',
  dob: 'birthdate',
  verjaardag: 'birthdate',
  rol: 'preferredRole',
  role: 'preferredRole',
  tier: 'preferredRole',
  type: 'preferredRole',
};

function headerMap(cells: string[]): Map<number, Field> | null {
  const map = new Map<number, Field>();
  cells.forEach((c, i) => {
    const f = HEADER_ALIASES[c.trim().toLowerCase()];
    if (f && ![...map.values()].includes(f)) map.set(i, f);
  });
  // A real header must at least identify the name column.
  return [...map.values()].includes('fullName') ? map : null;
}

function contactFromMappedRow(cells: string[], map: Map<number, Field>): ParsedContact | null {
  const out: Partial<Record<Field, string>> = {};
  for (const [i, f] of map) {
    const v = cells[i]?.trim();
    if (v) out[f] = v;
  }
  if (!out.fullName) return null;
  return buildContact(out.fullName, out.email, out.phone, out.birthdate, out.preferredRole);
}

/** Headerless row: first non-email/non-phone cell is the name; classify the rest. */
function contactFromLooseRow(cells: string[]): ParsedContact | null {
  const parts = cells.map((c) => c.trim()).filter((c) => c !== '');
  if (parts.length === 0) return null;
  let name: string | undefined;
  let email: string | undefined;
  let phone: string | undefined;
  let birthdate: string | undefined;
  let role: string | undefined;
  for (const p of parts) {
    if (!email && looksLikeEmail(p)) email = p;
    else if (!birthdate && parseDate(p)) birthdate = p;
    else if (!phone && looksLikePhone(p)) phone = p;
    else if (!role && mapRole(p)) role = p;
    else if (!name) name = p;
  }
  if (!name) return null;
  return buildContact(name, email, phone, birthdate, role);
}

function buildContact(
  name: string,
  email?: string,
  phone?: string,
  birthdate?: string,
  role?: string
): ParsedContact {
  const c: ParsedContact = { fullName: name.trim() };
  const e = email?.trim();
  if (e && looksLikeEmail(e)) c.email = e;
  const p = phone?.trim();
  if (p) c.phone = p;
  const b = parseDate(birthdate);
  if (b) c.birthdate = b;
  const r = mapRole(role);
  if (r) c.preferredRole = r;
  return c;
}

// ── Tokenisers ──────────────────────────────────────────────────────────────

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function sniffDelimiter(line: string): string {
  const counts: Record<string, number> = {
    ',': (line.match(/,/g) ?? []).length,
    ';': (line.match(/;/g) ?? []).length,
    '\t': (line.match(/\t/g) ?? []).length,
  };
  let best = ',';
  for (const d of [';', '\t']) if (counts[d] > counts[best]) best = d;
  return counts[best] > 0 ? best : ',';
}

/** Tokenise one line on a delimiter, honouring "quoted" fields and "" escapes. */
function tokenizeLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// ── Public parsers ────────────────────────────────────────────────────────────

/** Parse a CSV file (or pasted CSV). Detects a Dutch/English header; sniffs the delimiter. */
export function parseCsv(text: string): ParsedContact[] {
  const lines = stripBom(text)
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];

  const delim = sniffDelimiter(lines[0]);
  const rows = lines.map((l) => tokenizeLine(l, delim));
  const map = headerMap(rows[0]);
  const dataRows = map ? rows.slice(1) : rows;

  const out: ParsedContact[] = [];
  for (const cells of dataRows) {
    const c = map ? contactFromMappedRow(cells, map) : contactFromLooseRow(cells);
    if (c) out.push(c);
  }
  return out;
}

/**
 * Parse a pasted list — one contact per line. A line may be just a name, or
 * "Name, email, phone" (comma/semicolon/tab separated). No header.
 */
export function parsePastedList(text: string): ParsedContact[] {
  const lines = stripBom(text)
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');

  const out: ParsedContact[] = [];
  for (const line of lines) {
    const cells = /[,;\t]/.test(line) ? tokenizeLine(line, sniffDelimiter(line)) : [line];
    const c = contactFromLooseRow(cells);
    if (c) out.push(c);
  }
  return out;
}

/**
 * Collapse intra-file duplicates on the normalised key (e-mail first, else
 * phone). Name-only rows have no key and are never deduped. Keeps the first
 * occurrence; returns the kept rows + how many were dropped.
 */
export function dedupeWithin(rows: ParsedContact[]): { rows: ParsedContact[]; skipped: number } {
  const seen = new Set<string>();
  const kept: ParsedContact[] = [];
  let skipped = 0;
  for (const r of rows) {
    const email = normalizeEmail(r.email);
    const phone = normalizePhoneToDigits(r.phone);
    const key = email ? `e:${email}` : phone ? `p:${phone}` : null;
    if (key && seen.has(key)) {
      skipped++;
      continue;
    }
    if (key) seen.add(key);
    kept.push(r);
  }
  return { rows: kept, skipped };
}
