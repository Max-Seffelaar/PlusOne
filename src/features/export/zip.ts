// Minimal ZIP writer for the venue data export (legal v0.3 E1) — no new
// dependency. Server-only: it uses node:zlib for DEFLATE (CSV shrinks ~10×).
//
// Writes the classic PKZIP layout (local file header + data per entry, then
// the central directory and the end-of-central-directory record). No ZIP64:
// the export caps every table at 50 000 rows, which keeps each entry and the
// archive far below the 4 GiB / 65 535-entry limits. File names are ASCII
// (guests.csv …); the UTF-8 flag (bit 11) is set anyway so any name is read
// correctly.

import { deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/** CRC-32 (IEEE 802.3), as ZIP requires. */
export function crc32(buf: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date/time fields for the entry headers. */
function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function buildZip(entries: readonly ZipEntry[], now: Date = new Date()): Buffer {
  const { time, date } = dosDateTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const compressed = deflateRawSync(e.data);
    const crc = crc32(e.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed (2.0: deflate)
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra, comment, disk start, internal attrs = 0; external attrs = 0
    central.writeUInt32LE(offset, 42); // local header offset
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // entries total
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16); // central directory offset

  return Buffer.concat([...locals, ...centrals, end]);
}
