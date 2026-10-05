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
