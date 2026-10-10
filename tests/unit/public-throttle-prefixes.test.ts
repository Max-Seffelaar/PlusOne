/**
 * Public-throttle caller binding guard (20261006170000).
 *
 * consume_public_throttle only re-buckets an untrusted caller for key prefixes
 * it KNOWS embed a caller-supplied p_ip_hash ('req', 'pv', 'st', 'if', 'slug').
 * A new anon RPC that throttles on `'<new>:' || p_ip_hash` under a prefix
 * missing from that list would silently fail open — a raw PostgREST caller
 * could rotate p_ip_hash for a fresh bucket per call, the exact hole this
 * migration closed. This test turns that omission into a CI failure.
 *
 * Heuristic: a key built from a function PARAMETER (`p_*`) is caller-supplied;
 * a key built from a local (`v_uid` etc., e.g. 'pinv:' || v_uid) is
 * server-derived and needs no binding.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const CANONICAL = path.join(ROOT, 'supabase', 'canonical', 'consume_public_throttle.sql');
const SRC_DIR = path.join(ROOT, 'src');

/** The anon RPCs whose throttle key embeds p_ip_hash. */
const THROTTLED_ANON_RPCS = [
  'get_landing_event',
  'record_link_pageview',
  'submit_guest_request',
  'get_request_status',
  'get_influencer_stats',
  // Guest mail F (20261013180200): the guest status page + opt-out, on 'st'.
  'get_guest_status',
  'unsubscribe_guest_mail',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function boundPrefixes(): string[] {
  const body = readFileSync(CANONICAL, 'utf8');
  const match = body.match(/v_prefix in \(([^)]*)\)/);
  if (!match) throw new Error('consume_public_throttle canonical body has no `v_prefix in (...)` list');
  return [...match[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
}

function throttleCallSites(): Array<{ file: string; prefix: string; source: string }> {
  const sites: Array<{ file: string; prefix: string; source: string }> = [];
  const pattern = /consume_public_throttle\(\s*'([a-z]+):'\s*\|\|\s*([a-z_][a-z0-9_]*)/g;
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const content = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    for (const m of content.matchAll(pattern)) sites.push({ file, prefix: m[1], source: m[2] });
  }
  return sites;
}

describe('consume_public_throttle caller binding', () => {
  it('parses a non-empty bound-prefix list from the canonical body', () => {
    expect(boundPrefixes()).toEqual(expect.arrayContaining(['req', 'pv', 'st', 'if', 'slug']));
  });

  it('finds the known anon call sites (the scan is not blind)', () => {
    const prefixes = new Set(throttleCallSites().map((s) => s.prefix));
    for (const p of ['req', 'pv', 'st', 'if', 'slug', 'pinv']) expect(prefixes).toContain(p);
  });

  it('every key built from a caller-supplied parameter is under a bound prefix', () => {
    const bound = new Set(boundPrefixes());
    const unbound = throttleCallSites()
      .filter((s) => s.source.startsWith('p_') && !bound.has(s.prefix))
      .map((s) => `${s.file}: '${s.prefix}:' || ${s.source}`);
    expect(unbound, 'add the prefix to consume_public_throttle (new migration + canonical)').toEqual([]);
  });
});

describe('app call sites present the trust header', () => {
  // With enforcement on, a call site that forgets the header is bucketed with
  // raw callers: every guest of every venue shares one budget on that surface.
  it('every src file calling a throttled anon RPC builds its client with publicRpcTrustHeaders()', () => {
    const rpcCall = new RegExp(String.raw`\.rpc\(\s*'(${THROTTLED_ANON_RPCS.join('|')})'`);
    const callers = sourceFiles(SRC_DIR).filter((f) => rpcCall.test(readFileSync(f, 'utf8')));
    expect(callers.length).toBeGreaterThanOrEqual(4);
    const missing = callers
      .filter((f) => !/createClient\(\{\s*headers:\s*publicRpcTrustHeaders\(\)\s*\}\)/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    expect(missing).toEqual([]);
  });
});
