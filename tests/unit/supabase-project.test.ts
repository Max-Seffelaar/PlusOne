/**
 * Local-stack container names come from this checkout's supabase/config.toml
 * (scripts/lib/supabase-project.mjs), never from a hard-coded literal.
 *
 * dev-mfa.mjs used to hard-code `supabase_db_PlusOne_Guestlist`: in a worktree
 * running its own stack (another project_id) its API calls went to that stack
 * (URL from .env.local) while its SQL writes went to the shared one (found
 * 2026-10-11). The guard below fails if a script names a container literally.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseProjectId, supabaseContainer, supabaseProjectId } from '../../scripts/lib/supabase-project.mjs';

const CONFIG_URL = new URL('../../supabase/config.toml', import.meta.url);

describe('parseProjectId', () => {
  it('reads the top-level project_id', () => {
    expect(parseProjectId('# note\nproject_id = "PlusOne_Train"\n\n[api]\nport = 1\n')).toBe('PlusOne_Train');
  });

  it('handles CRLF and a trailing comment', () => {
    expect(parseProjectId('project_id = "A_B"  # local\r\n[db]\r\n')).toBe('A_B');
  });

  it('ignores a project_id inside a [section]', () => {
    expect(parseProjectId('[remotes.x]\nproject_id = "nope"\n')).toBeNull();
  });
});

describe('supabaseContainer', () => {
  it('derives the container from this checkout’s config', () => {
    const id = parseProjectId(readFileSync(CONFIG_URL, 'utf8'));
    expect(id).toBeTruthy();
    expect(supabaseContainer('db', CONFIG_URL, {})).toBe(`supabase_db_${id}`);
    expect(supabaseContainer('pg_meta', CONFIG_URL, {})).toBe(`supabase_pg_meta_${id}`);
  });

  it('SUPABASE_PROJECT_ID overrides the config', () => {
    expect(supabaseProjectId(CONFIG_URL, { SUPABASE_PROJECT_ID: 'Other' })).toBe('Other');
    expect(supabaseContainer('db', CONFIG_URL, { SUPABASE_PROJECT_ID: 'Other' })).toBe('supabase_db_Other');
  });
});

describe('no hard-coded local-stack container names', () => {
  it('scripts derive container names instead of naming them', () => {
    const tracked = execSync('git ls-files scripts', { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter((f) => /\.(m?js|ts|sh)$/.test(f));
    const offenders = tracked.filter((f) => {
      // Code only: comment lines may mention a name as an example.
      const code = readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\*|#)/.test(l))
        .join('\n');
      return /['"`]supabase_[a-z_]+_PlusOne_[A-Za-z]+['"`]/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
