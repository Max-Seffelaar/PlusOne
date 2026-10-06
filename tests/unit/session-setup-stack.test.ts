/**
 * Decision logic of `node scripts/session-setup.mjs stack` (scripts/lib/stack-plan.mjs).
 *
 * The step is opt-in and runs in two very different places: a disposable
 * Claude Code cloud container (root, CLAUDE_CODE_REMOTE=true) where it may
 * start dockerd and install a pinned supabase CLI, and a laptop where it must
 * never write a binary or start a root daemon. These tests pin that split and
 * the idempotency (nothing re-runs when everything is already in place)
 * without spawning a single process.
 */
import { describe, expect, it } from 'vitest';
import {
  SUPABASE_CLI,
  classifyEnvLocal,
  cliAsset,
  parseStatusEnv,
  parseSupabaseVersion,
  planStack,
  seedStateNote,
} from '../../scripts/lib/stack-plan.mjs';

type Facts = Parameters<typeof planStack>[0];

const cloudFromZero: Facts = {
  remote: true,
  startDocker: false,
  isRoot: true,
  platform: 'linux',
  arch: 'x64',
  dockerUp: false,
  dockerdPresent: true,
  cliVersion: null,
  stackRunning: false,
  envLocal: 'absent',
  devMfa: false,
};

const laptop: Facts = {
  ...cloudFromZero,
  remote: false,
  isRoot: false,
  platform: 'darwin',
  arch: 'arm64',
};

function runs(facts: Facts) {
  return planStack(facts)
    .actions.filter((a) => a.run)
    .map((a) => a.step);
}

describe('planStack — cloud container', () => {
  it('from zero: starts dockerd, installs the pinned CLI, starts the stack, writes env', () => {
    const plan = planStack(cloudFromZero);
    expect(plan.blockers).toEqual([]);
    expect(runs(cloudFromZero)).toEqual(['dockerd', 'cli', 'start', 'env']);
  });

  it('dev-mfa is opt-in: it flags admin@ as platform admin, which pgTAP refuses', () => {
    expect(runs(cloudFromZero)).not.toContain('mfa');
    expect(runs({ ...cloudFromZero, devMfa: true })).toEqual(['dockerd', 'cli', 'start', 'env', 'mfa']);
    expect(seedStateNote(true)).toMatch(/db:test FAILS/);
    expect(seedStateNote(false)).toMatch(/as in CI/);
    expect(seedStateNote(null)).toMatch(/could not read/);
  });

  it('second run is idempotent: nothing is (re)started', () => {
    const up: Facts = {
      ...cloudFromZero,
      dockerUp: true,
      cliVersion: SUPABASE_CLI.version,
      stackRunning: true,
      envLocal: 'local',
    };
    expect(runs(up)).toEqual([]);
    expect(planStack(up).blockers).toEqual([]);
    // with --dev-mfa only the idempotent stamp re-runs
    expect(runs({ ...up, devMfa: true })).toEqual(['mfa']);
  });

  it('a wrong CLI version is replaced by the pin', () => {
    const plan = planStack({ ...cloudFromZero, dockerUp: true, cliVersion: '2.40.0' });
    const cli = plan.actions.find((a) => a.step === 'cli');
    expect(cli?.run).toBe(true);
    expect(cli?.why).toContain('2.40.0');
  });

  it('cannot start dockerd without root, or without a dockerd binary', () => {
    const notRoot = planStack({ ...cloudFromZero, isRoot: false });
    expect(notRoot.blockers.length).toBe(1);
    expect(notRoot.actions.find((a) => a.step === 'dockerd')?.run).toBe(false);

    const noBinary = planStack({ ...cloudFromZero, dockerdPresent: false });
    expect(noBinary.blockers.join()).toMatch(/no dockerd binary/);
    // a blocker holds back every step that needs the stack
    expect(runs({ ...cloudFromZero, dockerdPresent: false })).toEqual(['cli']);
  });

  it('blocks on a platform without a pinned hash instead of installing something unverified', () => {
    const plan = planStack({ ...cloudFromZero, dockerUp: true, arch: 'ia32' });
    expect(plan.actions.find((a) => a.step === 'cli')?.run).toBe(false);
    expect(plan.blockers.join()).toMatch(/no pinned supabase CLI hash/);
  });
});

describe('planStack — laptop (no CLAUDE_CODE_REMOTE)', () => {
  it('never starts a daemon or installs a binary — it only reports', () => {
    const plan = planStack(laptop);
    expect(runs(laptop)).toEqual([]);
    expect(plan.blockers.join('\n')).toMatch(/docker daemon unreachable/);
    expect(plan.blockers.join('\n')).toMatch(/never writes binaries on a laptop/);
  });

  it('does not start dockerd on a local root Linux box either, unless --start-docker is passed', () => {
    const localRoot: Facts = { ...laptop, isRoot: true, platform: 'linux', arch: 'x64', cliVersion: SUPABASE_CLI.version };
    expect(runs(localRoot)).toEqual([]);
    expect(runs({ ...localRoot, startDocker: true })).toEqual(['dockerd', 'start', 'env']);
  });

  it('--start-docker never installs a CLI off the cloud', () => {
    expect(runs({ ...laptop, isRoot: true, platform: 'linux', arch: 'x64', startDocker: true })).toEqual(['dockerd']);
  });

  it('a non-pinned local CLI is a warning, not a refusal or a reinstall', () => {
    const plan = planStack({ ...laptop, dockerUp: true, cliVersion: '2.84.2' });
    expect(plan.blockers).toEqual([]);
    expect(plan.actions.find((a) => a.step === 'cli')?.run).toBe(false);
    expect(plan.warnings.join()).toMatch(/2\.84\.2/);
    expect(runs({ ...laptop, dockerUp: true, cliVersion: '2.84.2' })).toEqual(['start', 'env']);
  });
});

describe('.env.local is never touched', () => {
  it('an existing prod-pointing file is left alone and flagged', () => {
    const plan = planStack({ ...cloudFromZero, envLocal: 'remote' });
    expect(plan.actions.find((a) => a.step === 'env')?.run).toBe(false);
    expect(plan.warnings.join()).toMatch(/NON-local/);
  });

  it('an existing local file is left alone silently', () => {
    const plan = planStack({ ...cloudFromZero, envLocal: 'local' });
    expect(plan.actions.find((a) => a.step === 'env')?.run).toBe(false);
    expect(plan.warnings).toEqual([]);
  });

  it('classifies where a .env.local points', () => {
    expect(classifyEnvLocal(null)).toBe('absent');
    expect(classifyEnvLocal('NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321\n')).toBe('local');
    expect(classifyEnvLocal('NEXT_PUBLIC_SUPABASE_URL="http://localhost:55321"')).toBe('local');
    expect(classifyEnvLocal('NEXT_PUBLIC_SUPABASE_URL=https://tolxwgqhppdcvnogdpel.supabase.co')).toBe('remote');
    expect(classifyEnvLocal('NEXT_PUBLIC_SUPABASE_URL=http://localhost.evil.example')).toBe('remote');
    // no URL at all: treat as not-ours rather than assume local
    expect(classifyEnvLocal('FOO=bar')).toBe('remote');
  });
});

describe('parsers', () => {
  it('parses supabase --version output', () => {
    expect(parseSupabaseVersion('2.119.0\n')).toBe('2.119.0');
    expect(parseSupabaseVersion('supabase version 2.40.7')).toBe('2.40.7');
    expect(parseSupabaseVersion(null)).toBeNull();
    expect(parseSupabaseVersion('')).toBeNull();
  });

  it('parses supabase status -o env output', () => {
    const env = parseStatusEnv('API_URL="http://127.0.0.1:55321"\nDB_URL="postgresql://postgres:postgres@127.0.0.1:55322/postgres"\n');
    expect(env.API_URL).toBe('http://127.0.0.1:55321');
    expect(env.DB_URL).toContain('55322');
    expect(parseStatusEnv(null)).toEqual({});
  });

  it('builds a versioned, hash-pinned release asset', () => {
    const a = cliAsset('linux', 'x64');
    expect(a?.url).toBe(
      `https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI.version}/supabase_${SUPABASE_CLI.version}_linux_amd64.tar.gz`
    );
    expect(a?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(cliAsset('win32', 'x64')).toBeNull();
  });
});
