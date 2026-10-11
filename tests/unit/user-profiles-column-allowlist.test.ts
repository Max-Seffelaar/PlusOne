/**
 * user_profiles column-allowlist guard (20261016120100, review #460 finding 6).
 *
 * `authenticated` may SELECT only id, full_name, email and has_joined on
 * user_profiles — the columns the app reads on ANOTHER user's row. Everything
 * else (phone, mfa_snooze_until, is_platform_admin, first/last name,
 * terms_version, terms_accepted_at, timestamps) is read through my_profile() / is_platform_admin().
 * The generated `Tables['user_profiles']['Row']` still advertises every column,
 * so `.from('user_profiles').select('phone')` type-checks and only fails in
 * prod with a 42501 — on the consent gate that means every user bounces. This
 * guard makes that a CI failure instead.
 *
 * It scans src/ for the two shapes PostgREST reads take:
 *   1. a `.from('user_profiles')` chain: every `.select(...)` in it (including
 *      one chained after `.insert/.update/.upsert`, which RETURNs columns), and
 *      a bare `.select()` / `'*'`, which names every column;
 *   2. an embed inside any select string: `user_profiles(...)`,
 *      `user_profiles!fk(...)`, `alias:user_profiles!fk(...)`.
 * Widening the allowlist below means widening the grant in a migration first
 * (grant_matrix.test.sql guards that side).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const ALLOWED = new Set(['id', 'full_name', 'email', 'has_joined']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
    if (entry.name === 'database.types.ts') continue;
    out.push(full);
  }
  return out;
}

/** Column names in a PostgREST select list, top level only (embeds of other tables skipped). */
function topLevelColumns(list: string): string[] {
  const cols: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      cols.push(cur);
      cur = '';
      continue;
    }
    if (depth === 0) cur += ch;
  }
  cols.push(cur);
  return cols
    .map((c) => c.trim())
    .filter(Boolean)
    // `alias:column` and `column::cast` → the column name
    .map((c) => c.replace(/^[\w]+:/, '').replace(/::\w+$/, '').trim());
}

const FROM_CHAIN = /\.from\(\s*['"]user_profiles['"]\s*\)([\s\S]*?)(?:;|\n\s*\n)/g;
const SELECT_CALL = /\.select\(\s*(?:(['"`])([\s\S]*?)\1)?/g;
const EMBED = /(?:[\w]+:)?user_profiles(?:![\w]+)?\(([^()]*)\)/g;

interface Offence {
  file: string;
  what: string;
}

function scan(file: string): Offence[] {
  const src = readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const out: Offence[] = [];

  for (const chain of src.matchAll(FROM_CHAIN)) {
    for (const sel of (chain[1] ?? '').matchAll(SELECT_CALL)) {
      const list = sel[2];
      if (list === undefined || list.trim() === '' || list.trim() === '*') {
        out.push({ file: rel, what: `.from('user_profiles') … .select(${list === undefined ? '' : `'${list}'`}) names every column` });
        continue;
      }
      for (const col of topLevelColumns(list)) {
        if (!ALLOWED.has(col)) out.push({ file: rel, what: `.from('user_profiles').select(…${col}…)` });
      }
    }
  }

  for (const embed of src.matchAll(EMBED)) {
    for (const col of topLevelColumns(embed[1] ?? '')) {
      if (col === '*' || !ALLOWED.has(col)) out.push({ file: rel, what: `embed ${embed[0]} reads ${col}` });
    }
  }
  return out;
}

const FILES = sourceFiles(path.join(ROOT, 'src'));

describe('user_profiles reads stay inside the authenticated column grant', () => {
  it('finds user_profiles reads to check (sanity — the scan is not empty)', () => {
    const hits = FILES.filter((f) => /user_profiles/.test(readFileSync(f, 'utf8')));
    expect(hits.length).toBeGreaterThan(5);
  });

  it('the scanner itself flags private columns, star selects and embeds', () => {
    const probe = (code: string): string[] => {
      const out: string[] = [];
      for (const chain of code.matchAll(FROM_CHAIN)) {
        for (const sel of (chain[1] ?? '').matchAll(SELECT_CALL)) {
          const list = sel[2];
          if (list === undefined || list.trim() === '*') out.push('*');
          else out.push(...topLevelColumns(list).filter((c) => !ALLOWED.has(c)));
        }
      }
      for (const e of code.matchAll(EMBED)) out.push(...topLevelColumns(e[1] ?? '').filter((c) => !ALLOWED.has(c)));
      return out;
    };
    expect(probe(`await c.from('user_profiles').select('id, phone').eq('id', x);`)).toEqual(['phone']);
    expect(probe(`await c.from('user_profiles').select().eq('id', x);`)).toEqual(['*']);
    expect(probe(`await c.from('user_profiles').update({ a: 1 }).eq('id', x).select('mfa_snooze_until');`)).toEqual([
      'mfa_snooze_until',
    ]);
    expect(probe(`c.from('x').select('id, p:user_profiles!fk(full_name, is_platform_admin)')`)).toEqual([
      'is_platform_admin',
    ]);
    expect(probe(`c.from('user_profiles').select('id, full_name, email, has_joined');`)).toEqual([]);
    expect(probe(`c.from('x').select('user_profiles(full_name, terms_accepted_at)')`)).toEqual(['terms_accepted_at']);
    expect(probe(`c.rpc('my_profile').select('phone, mfa_snooze_until');`)).toEqual([]);
  });

  it('no authenticated read names a column outside id, full_name, email, has_joined', () => {
    const offences = FILES.flatMap(scan);
    expect(offences.map((o) => `${o.file}: ${o.what}`)).toEqual([]);
  });
});
