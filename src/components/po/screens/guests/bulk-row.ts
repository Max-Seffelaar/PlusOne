// Pure row logic for "Paste a list" (#33) — extracted from index.tsx so the
// screen stays under the 800-LOC line. No React, no I/O: the screen owns state
// and rendering, this module only folds a parsed line into an addable row.

import { resolveAmbiguity, type AmbiguityChoice, type ParseResult } from '@/features/guests/quick-add-parser';
import { t, fmt } from '@/lib/i18n';

export interface ResolvedRow {
  name: string;
  plusOnes: number;
  tierId: string;
  needsChoice: boolean;
}

/** Fold a parsed line + the user's chip choice into a final addable row. */
export function resolveRow(r: ParseResult, choice: AmbiguityChoice | undefined, defaultTierId: string): ResolvedRow {
  if (r.status === 'ambiguous') {
    if (!choice) return { name: r.name, plusOnes: r.plusOnes, tierId: defaultTierId, needsChoice: true };
    const res = resolveAmbiguity(r, choice, defaultTierId);
    return { name: res.name, plusOnes: res.plusOnes, tierId: res.tierId, needsChoice: false };
  }
  return { name: r.name, plusOnes: r.plusOnes, tierId: r.tierId ?? defaultTierId, needsChoice: false };
}

// ── Per-row inline fix (parity with the contacts import, T12) ─────────────────
// A pasted e-mail/phone that is broken (Jesse's "name#mail.com", Mila's
// "06-ABC-4567", an obfuscated "x at y dot z", a too-short "020") is silently
// left in the name by the #33 parser. We recover it from the raw line so it lands
// in the editor FLAGGED — the user fixes it inline, or removes the row. Nothing is
// silently dropped or mangled.
const BULK_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BULK_NAME_MAX = 500;

export interface RowFix {
  name?: string;
  email?: string;
  phone?: string;
}

/** digits only. */
function bulkDigits(v: string): number {
  return v.replace(/\D/g, '').length;
}
/** A plausible guest phone: 8–15 digits, phone-ish chars only. */
function isValidBulkPhone(v: string): boolean {
  return /^[+()\-\s./0-9]+$/.test(v) && bulkDigits(v) >= 8 && bulkDigits(v) <= 15;
}
/** A CSV cell that is an e-mail ATTEMPT (so it can be flagged, not hidden). */
function isEmailAttempt(cell: string): boolean {
  if (/@/.test(cell)) return true;
  if (!/\s/.test(cell) && /#/.test(cell) && /\.[a-z]{2,}$/i.test(cell)) return true; // name#mail.com
  if (/\bat\b/i.test(cell) && /\bdot\b/i.test(cell)) return true; // x at y dot z
  return false;
}
/** A CSV cell clearly meant as a phone but not a valid one (letters, too short…). */
function isPhoneAttempt(cell: string): boolean {
  return /\d/.test(cell) && bulkDigits(cell) >= 3 && /^[+()\-\s./0-9A-Za-z]+$/.test(cell) && !isValidBulkPhone(cell);
}
/** Remove a captured/attempted fragment from the parser's name string. */
function stripFragment(name: string, frag: string): string {
  return name.replace(frag, '').replace(/\s{2,}/g, ' ').trim();
}

export interface BulkRowView {
  name: string;
  email: string;
  phone: string;
  /** null = valid; else why it can't be added yet. */
  error: string | null;
}

/** Recover broken contact info from the raw line, apply the user's inline edit,
 *  then validate exactly like addGuestSchema (name ≤500, e-mail/phone shape). */
export function buildBulkRow(r: ParseResult, resolvedName: string, ed: RowFix | undefined): BulkRowView {
  let name = resolvedName;
  let email = r.email ?? '';
  let phone = r.phone ?? '';
  for (const c of r.raw.split(/[,;\t]/).map((x) => x.trim()).filter(Boolean)) {
    if (c === r.email || c === r.phone) continue;
    if (!email && isEmailAttempt(c)) {
      email = c; // keep the raw broken value so it stays flagged for the user to fix
      name = stripFragment(name, c);
    } else if (!phone && isPhoneAttempt(c)) {
      phone = c;
      name = stripFragment(name, c);
    }
  }
  name = (ed?.name ?? name).trim();
  email = (ed?.email ?? email).trim();
  phone = (ed?.phone ?? phone).trim();

  let error: string | null = null;
  if (name === '') error = t.guests.bulk.errName;
  else if (name.length > BULK_NAME_MAX) error = fmt(t.guests.bulk.errNameLong, { n: name.length });
  else if (email !== '' && !BULK_EMAIL_RE.test(email)) error = t.guests.bulk.errEmail;
  else if (phone !== '' && !isValidBulkPhone(phone)) error = t.guests.bulk.errPhone;
  return { name, email, phone, error };
}
