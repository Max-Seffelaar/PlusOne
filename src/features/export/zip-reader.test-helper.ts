// Test-only ZIP reader: walks the local file headers buildZip writes and
// inflates each entry, so the tests check a real round-trip, not our own bytes.
import { inflateRawSync } from 'node:zlib';
import { crc32 } from './zip';

export function readZip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const crc = buf.readUInt32LE(p + 14);
    const csize = buf.readUInt32LE(p + 18);
    const usize = buf.readUInt32LE(p + 22);
    const nlen = buf.readUInt16LE(p + 26);
    const xlen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nlen).toString('utf8');
    const start = p + 30 + nlen + xlen;
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    if (data.length !== usize) throw new Error(`size mismatch in ${name}`);
    if (crc32(data) !== crc) throw new Error(`crc mismatch in ${name}`);
    out.set(name, data.toString('utf8'));
    p = start + csize;
  }
  if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('no central directory');
  return out;
}
