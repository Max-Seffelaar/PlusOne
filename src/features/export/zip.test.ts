import { describe, it, expect } from 'vitest';
import { buildZip, crc32 } from './zip';
import { readZip } from './zip-reader.test-helper';

describe('crc32', () => {
  it('matches the IEEE check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
});

describe('buildZip', () => {
  it('round-trips four CSV entries', () => {
    const files = [
      { name: 'guests.csv', data: Buffer.from('﻿a,b\r\n1,2\r\n') },
      { name: 'contacts.csv', data: Buffer.from('x'.repeat(10_000)) },
      { name: 'requests.csv', data: Buffer.from('') },
      { name: 'door.csv', data: Buffer.from('Zoë,"x\ny"\r\n') },
    ];
    const zip = buildZip(files, new Date('2026-10-06T12:00:00Z'));
    const read = readZip(zip);
    expect([...read.keys()]).toEqual(['guests.csv', 'contacts.csv', 'requests.csv', 'door.csv']);
    for (const f of files) expect(read.get(f.name)).toBe(f.data.toString('utf8'));
    // End-of-central-directory record names all four entries.
    const eocd = zip.subarray(zip.length - 22);
    expect(eocd.readUInt32LE(0)).toBe(0x06054b50);
    expect(eocd.readUInt16LE(10)).toBe(4);
  });

  it('compresses repetitive CSV', () => {
    const big = Buffer.from('name,email\r\n'.repeat(5_000));
    expect(buildZip([{ name: 'a.csv', data: big }]).length).toBeLessThan(big.length / 10);
  });
});
