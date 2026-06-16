import { describe, expect, it } from 'vitest';
import {
  dedupeWithin,
  mapRole,
  normalizeEmail,
  normalizePhoneToDigits,
  parseCsv,
  parseDate,
  parsePastedList,
  type ParsedContact,
} from './parse';

describe('normalizeEmail', () => {
  it('lowercases, trims, and nulls empties (mirrors contacts.email_norm)', () => {
    expect(normalizeEmail('  Anouk@Example.TEST ')).toBe('anouk@example.test');
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe('normalizePhoneToDigits', () => {
  it('strips every non-digit (mirrors the DB [^0-9] regexp_replace)', () => {
    expect(normalizePhoneToDigits('+31 6 22-22 22 22')).toBe('31622222222');
    expect(normalizePhoneToDigits('(06) 12.34.56.78')).toBe('0612345678');
    expect(normalizePhoneToDigits('+31612345678')).toBe('31612345678');
    expect(normalizePhoneToDigits('')).toBeNull();
    expect(normalizePhoneToDigits('abc')).toBeNull();
  });

  it('collapses different formats of the same number to the same key', () => {
    expect(normalizePhoneToDigits('+31 6 12345678')).toBe(normalizePhoneToDigits('+31612345678'));
  });
});

describe('parseDate', () => {
  it('accepts ISO and dd-mm-yyyy / dd/mm/yyyy → ISO', () => {
    expect(parseDate('1996-04-12')).toBe('1996-04-12');
    expect(parseDate('12-04-1996')).toBe('1996-04-12');
    expect(parseDate('12/4/1996')).toBe('1996-04-12');
  });
  it('rejects junk', () => {
    expect(parseDate('not a date')).toBeUndefined();
    expect(parseDate('')).toBeUndefined();
    expect(parseDate('1996')).toBeUndefined();
  });
});

describe('mapRole', () => {
  it('maps nl/en aliases to a ContactRole', () => {
    expect(mapRole('VIP')).toBe('vip');
    expect(mapRole('all access')).toBe('all_access');
    expect(mapRole('aa')).toBe('all_access');
    expect(mapRole('artiest')).toBe('artist');
    expect(mapRole('pers')).toBe('press');
    expect(mapRole('crew')).toBe('crew');
    expect(mapRole('gast')).toBe('guest');
    expect(mapRole('onzin')).toBeUndefined();
  });
});

describe('parseCsv', () => {
  it('detects a Dutch header and maps columns', () => {
    const csv = 'Naam,E-mail,Telefoon,Geboortedatum,Rol\nAnouk Smit,anouk@x.test,+31612345678,1996-04-12,VIP';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual<ParsedContact>({
      fullName: 'Anouk Smit',
      email: 'anouk@x.test',
      phone: '+31612345678',
      birthdate: '1996-04-12',
      preferredRole: 'vip',
    });
  });

  it('sniffs a semicolon delimiter and strips a BOM', () => {
    const csv = '﻿Naam;E-mail\nPim Scholten;pim@x.test';
    const rows = parseCsv(csv);
    expect(rows).toEqual([{ fullName: 'Pim Scholten', email: 'pim@x.test' }]);
  });

  it('honours quoted fields containing the delimiter', () => {
    const csv = 'Naam,E-mail\n"Jansen, Marit",marit@x.test';
    const rows = parseCsv(csv);
    expect(rows[0].fullName).toBe('Jansen, Marit');
    expect(rows[0].email).toBe('marit@x.test');
  });

  it('classifies a headerless file by cell content', () => {
    const csv = 'Sanne Mulder,sanne@x.test,+31687654321';
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual({
      fullName: 'Sanne Mulder',
      email: 'sanne@x.test',
      phone: '+31687654321',
    });
  });

  it('drops rows without a usable name', () => {
    const csv = 'Naam,E-mail\n,leeg@x.test\nNoor de Wit,noor@x.test';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].fullName).toBe('Noor de Wit');
  });
});

describe('parsePastedList', () => {
  it('takes one name per line and ignores blanks', () => {
    const rows = parsePastedList('Anouk Smit\n\n  Femke Bakker  \n');
    expect(rows).toEqual([{ fullName: 'Anouk Smit' }, { fullName: 'Femke Bakker' }]);
  });

  it('splits "Name, email, phone" lines', () => {
    const rows = parsePastedList('Sanne Mulder, sanne@x.test, +31687654321');
    expect(rows[0]).toEqual({
      fullName: 'Sanne Mulder',
      email: 'sanne@x.test',
      phone: '+31687654321',
    });
  });
});

describe('dedupeWithin', () => {
  it('collapses duplicates on email then phone, keeping the first', () => {
    const { rows, skipped } = dedupeWithin([
      { fullName: 'A', email: 'dup@x.test' },
      { fullName: 'B', email: 'DUP@x.test' },
      { fullName: 'C', phone: '+31611111111' },
      { fullName: 'D', phone: '+31 6 11111111' },
    ]);
    expect(skipped).toBe(2);
    expect(rows.map((r) => r.fullName)).toEqual(['A', 'C']);
  });

  it('never dedupes name-only rows', () => {
    const { rows, skipped } = dedupeWithin([{ fullName: 'Jan' }, { fullName: 'Jan' }]);
    expect(skipped).toBe(0);
    expect(rows).toHaveLength(2);
  });
});
