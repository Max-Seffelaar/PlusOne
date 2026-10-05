// CSV writer for the venue data export (legal v0.3 E1).
//
// RFC 4180: CRLF line endings; a field containing a comma, a double quote, CR
// or LF is wrapped in double quotes and inner quotes are doubled. A UTF-8 BOM
// leads the file so Excel opens accented names (Zoë, Jiří) correctly.
//
// Formula injection (CSV injection, OWASP): a spreadsheet treats a cell that
// starts with = + - @ (and, in some apps, TAB or CR) as a formula. Every one of
// these fields is free text a guest typed into a public form, so a request with
// the name `=HYPERLINK("https://evil.example","click")` must not become a live
// formula on the venue admin's laptop. Any STRING cell starting with one of
// those characters gets a leading apostrophe, which spreadsheets render as
// "text" and hide. Trade-off, accepted on purpose: E.164 phone numbers start
// with "+", so they arrive as '+31612345678 — visible as +31612345678 in Excel,
// but with the apostrophe in a plain-text viewer. Numbers and booleans are
// written as-is (they are ours, not user input) and are never prefixed.

export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** One CSV cell: formula-guarded, then quoted when needed. */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let s = value;
  if (FORMULA_START.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A whole CSV file: BOM + header row + one row per record, CRLF-separated. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers.map(csvField).join(',')];
  for (const row of rows) lines.push(row.map(csvField).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
