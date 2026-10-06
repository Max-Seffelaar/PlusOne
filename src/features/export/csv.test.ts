import { describe, it, expect } from 'vitest';
import { csvField, toCsv } from './csv';

describe('csvField — RFC 4180 escaping', () => {
  it('leaves plain text alone', () => {
    expect(csvField('Max de Vries')).toBe('Max de Vries');
  });

  it('quotes a field with a comma', () => {
    expect(csvField('Bakker, Tom')).toBe('"Bakker, Tom"');
  });

  it('doubles inner quotes and wraps the field', () => {
    expect(csvField('says "hi"')).toBe('"says ""hi"""');
  });

  it('quotes newlines in notes (LF and CRLF)', () => {
    expect(csvField('line 1\nline 2')).toBe('"line 1\nline 2"');
    expect(csvField('a\r\nb')).toBe('"a\r\nb"');
  });

  it('writes null/undefined as an empty cell, numbers and booleans verbatim', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(3)).toBe('3');
    expect(csvField(-1)).toBe('-1');
    expect(csvField(true)).toBe('true');
    expect(csvField(false)).toBe('false');
  });
});

describe('csvField — formula-injection guard', () => {
  it.each(['=1+1', '+31612345678', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])(
    'prefixes %j with an apostrophe',
    (v) => {
      expect(csvField(v).replace(/^"/, '').startsWith(`'${v[0]}`)).toBe(true);
    },
  );

  it('guards a hyperlink payload and still quotes it', () => {
    expect(csvField('=HYPERLINK("https://evil.example","x")')).toBe(
      `"'=HYPERLINK(""https://evil.example"",""x"")"`,
    );
  });

  // Dutch Excel splits a .csv on `;`: an unquoted `Jan;=HYPERLINK(...)` would
  // put a live formula in the second cell. Quoting keeps it one text cell.
  it('quotes a field with a semicolon and guards the formula after it', () => {
    expect(csvField('Jan;=HYPERLINK("https://evil.example","x")')).toBe(
      `"Jan;'=HYPERLINK(""https://evil.example"",""x"")"`,
    );
    expect(csvField('a;b')).toBe('"a;b"');
  });

  it('guards a formula after a TAB, a line break or a pipe mid-field', () => {
    expect(csvField('Jan\t=1+1')).toBe(`"Jan\t'=1+1"`);
    expect(csvField('hi\n=1+1')).toBe(`"hi\n'=1+1"`);
    expect(csvField('Jan|@SUM(A1)')).toBe(`"Jan|'@SUM(A1)"`);
  });

  it('guards a formula behind leading whitespace, NBSP, zero-width space or a quote', () => {
    expect(csvField('  =1+1')).toBe(`'  =1+1`);
    expect(csvField('\u00A0=1+1')).toBe(`'\u00A0=1+1`);
    expect(csvField('\u200B=1+1')).toBe(`'\u200B=1+1`);
    expect(csvField('"=1+1')).toBe(`"'""=1+1"`);
  });

  it('does not touch the characters mid-field', () => {
    expect(csvField('a=b')).toBe('a=b');
    expect(csvField('Anne-Marie')).toBe('Anne-Marie');
  });
});

describe('toCsv', () => {
  it('writes a BOM, a header row and CRLF-separated rows', () => {
    const out = toCsv(['name', 'note'], [['Zoë', 'a, b'], ['Tom', null]]);
    expect(out).toBe('﻿name,note\r\nZoë,"a, b"\r\nTom,\r\n');
  });

  it('keeps a multi-line note inside one record', () => {
    const out = toCsv(['note'], [['x\ny']]);
    const body = out.slice(1);
    expect(body.split('\r\n').filter(Boolean)).toEqual(['note', '"x\ny"']);
  });
});

// File-level proof (security review of #391): a field's quoting only protects
// it in a reader that honours the quote — a `;`-locale Excel does so only at a
// cell START, so a quoted field in any later column splits on its own `;`, and
// a line break inside it ends the record. This reader is deliberately harsher
// than any real one: it ignores quoting entirely and splits on every separator
// any locale or import wizard might use. No resulting cell may start a formula.
describe('toCsv — no formula cell under any separator', () => {
  const hostileCells = (csv: string): string[] => csv.replace(/^\uFEFF/, '').split(/[,;\t|\r\n]/);
  const startsFormula = (cell: string): boolean => /^[\s"\u200B\uFEFF]*[=+\-@]/u.test(cell);

  const payloads = [
    'Jan;=1+1;',
    'x;=HYPERLINK(CHAR(104)&"ttps://evil.example","click");',
    "x;=cmd|' /C calc'!A0;",
    'hi\n=1+1;',
    'hi\r\n+1+1',
    'a\t@SUM(A1)',
    'a|-2+3',
    'a, =1+1',
    'a;"=1+1',
    'a; \u00A0=1+1',
    '=1+1',
    ' @x',
    '\u200B-1',
  ];

  it.each(payloads)('%j in every column of a row stays inert', (payload) => {
    for (let col = 0; col < 4; col++) {
      const row: string[] = ['Event', 'Jan', 'jan@x.nl', 'note'];
      row[col] = payload;
      const csv = toCsv(['a', 'b', 'c', 'd'], [row]);
      const bad = hostileCells(csv).filter(startsFormula);
      expect(bad, `column ${col}`).toEqual([]);
    }
  });
});
