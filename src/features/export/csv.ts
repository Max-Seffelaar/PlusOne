// CSV writer for the venue data export (legal v0.3 E1).
//
// RFC 4180: CRLF line endings; a field containing a comma, a double quote, CR
// or LF (and, for locale safety below, `;` or TAB) is wrapped in double
// quotes and inner quotes are doubled. A UTF-8 BOM leads the file so Excel
// opens accented names (Zoë, Jiří) correctly.
//
// Formula injection (CSV injection, OWASP): a spreadsheet treats a cell that
// starts with = + - @ (and, in some apps, TAB or CR) as a formula. Every one of
// these fields is free text a guest typed into a public form, so a request with
// the name `=HYPERLINK("https://evil.example","click")` must not become a live
// formula on the venue admin's laptop. Any STRING cell starting with one of
// those characters gets a leading apostrophe, so it is read as text. Opening a
// .csv does NOT hide that apostrophe (hiding it is a typed-in-cell convention):
// it stays visible in Excel, LibreOffice and Sheets alike. Trade-off, accepted
// on purpose: E.164 phone numbers start with "+", so they arrive as
// '+31612345678. Do not drop the guard to "fix" that. Numbers and booleans are
// written as-is (they are ours, not user input) and are never prefixed.
//
// Locale separators: Dutch (and most continental) Excel opens a .csv with the
// system list separator `;`, not `,`, and only honours a double quote at the
// START of a cell. A field in any later column therefore gets no protection
// from quoting: `EventX,"Jan;=1+1;",...` splits into `EventX,"Jan` | `=1+1` |
// `",...`, and a line break inside a quoted field ends the record there. So,
// besides quoting (`;`, TAB and `|` included, which keeps a field whole for a
// comma-locale reader and for the first column), the guard puts an apostrophe
// after EVERY point where a reader can start a new cell — `,` `;` TAB `|` CR
// LF — when a formula character follows (past whitespace or a stray quote).
// Leading whitespace (incl. NBSP, zero-width space, BOM) is looked past the
// same way.
// Proof lives in csv.test.ts: toCsv output is re-parsed the way a `;`-locale
// reader does (quotes honoured only at a cell start, every line break ends a
// record) and no cell may start with a formula character.

export type CsvValue = string | number | boolean | null | undefined;

// Whitespace a spreadsheet may trim before reading a cell: \s covers ASCII
// space/TAB/CR/LF/VT/FF, NBSP and the Unicode spaces; zero-width space and
// BOM are added because \s does not match them, and a double quote, so a
// field like `"=1+1` cannot hide its formula behind a cell-opening quote.
const FORMULA_START = /^[\s"\u200B\uFEFF]*[=+\-@\t\r]/u;
/** A point where some reader starts a new cell or record (`,` `;` TAB `|` CR
 *  LF, plus the rarer breaks VT FF NEL U+2028 U+2029 — cheap to cover even
 *  though no mainstream spreadsheet is known to split on them), followed —
 *  past whitespace and stray double quotes — by a formula character. `,` is
 *  included so the guard holds even for a reader that ignores quoting. */
const SPLIT_FORMULA = /([,;\t\r\n|\v\f\u0085\u2028\u2029][\s"\u200B\uFEFF]*)(?=[=+\-@])/gu;
const NEEDS_QUOTES = /[",;|\t\r\n]/;

/** One CSV cell: formula-guarded, then quoted when needed. */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let s = value;
  if (FORMULA_START.test(s)) s = `'${s}`;
  s = s.replace(SPLIT_FORMULA, "$1'");
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A whole CSV file: BOM + header row + one row per record, CRLF-separated. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers.map(csvField).join(',')];
  for (const row of rows) lines.push(row.map(csvField).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
