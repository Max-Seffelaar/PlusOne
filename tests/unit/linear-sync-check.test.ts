/**
 * Stop-hook contract for the Linear session marker (PLU-70).
 *
 * The hook is the only thing that makes "end the session with Linear out of
 * sync" structurally impossible, so its five behaviours are pinned here by
 * running the real script as a child process with a temp project dir:
 * no marker → silent pass; unsynced → block naming the issue; synced → pass;
 * corrupt marker → block with repair instructions; stop_hook_active → pass
 * (retry-loop guard). The legacy ClickUp marker keeps blocking too.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = path.join(process.cwd(), 'scripts', 'hooks', 'linear-sync-check.mjs');

let root: string;

function runHook(stdin = '{}') {
  const res = spawnSync(process.execPath, [HOOK], {
    input: stdin,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
  });
  const out = res.stdout.trim();
  return { status: res.status, out, json: out ? JSON.parse(out) : null };
}

function writeMarker(name: string, content: string) {
  writeFileSync(path.join(root, '.claude', name), content);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'linear-hook-'));
  mkdirSync(path.join(root, '.claude'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scripts/hooks/linear-sync-check.mjs', () => {
  it('passes silently when no marker exists', () => {
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.out).toBe('');
  });

  it('blocks while an issue in the marker is unsynced and names it', () => {
    writeMarker('linear-session.json', '{"issues":[{"id":"PLU-70","synced":false}]}');
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.json?.decision).toBe('block');
    expect(r.json?.reason).toContain('PLU-70');
    expect(r.json?.reason).toContain('linear-task');
  });

  it('passes once every issue in the marker is synced', () => {
    writeMarker(
      'linear-session.json',
      '{"issues":[{"id":"PLU-70","synced":true},{"id":"PLU-71","synced":true}]}'
    );
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.out).toBe('');
  });

  it('blocks with repair instructions on a corrupt marker', () => {
    writeMarker('linear-session.json', '{"issues":[');
    const r = runHook();
    expect(r.json?.decision).toBe('block');
    expect(r.json?.reason).toContain('not valid JSON');
    expect(r.json?.reason).toContain('"issues"');
  });

  it('lets a blocked stop through on the retry turn (stop_hook_active)', () => {
    writeMarker('linear-session.json', '{"issues":[{"id":"PLU-70","synced":false}]}');
    const r = runHook('{"stop_hook_active":true}');
    expect(r.status).toBe(0);
    expect(r.out).toBe('');
  });

  it('still honours a stale legacy ClickUp marker', () => {
    writeMarker('clickup-session.json', '{"tasks":[{"id":"86ey9c5d2","synced":false}]}');
    const r = runHook();
    expect(r.json?.decision).toBe('block');
    expect(r.json?.reason).toContain('86ey9c5d2');
  });

  it('fails open on unreadable stdin', () => {
    const r = runHook('not json');
    expect(r.status).toBe(0);
    expect(r.out).toBe('');
  });
});
