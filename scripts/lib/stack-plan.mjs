// Decision half of `node scripts/session-setup.mjs stack`, split out so it can
// be unit-tested without docker, a network or a Supabase CLI — see
// tests/unit/session-setup-stack.test.ts. Nothing in this file spawns a
// process or touches the filesystem: session-setup.mjs gathers the facts,
// planStack() decides, session-setup.mjs executes.
//
// The asymmetry this encodes: a Claude Code cloud container
// (CLAUDE_CODE_REMOTE=true) is a throwaway root box, so the step may start a
// daemon and drop a binary into /usr/local/bin there. A laptop is somebody's
// machine — the step never installs binaries or starts a root daemon on it; it
// reports what is missing and what to run instead.

// Pinned, not "latest": a cloud session must test against a CLI we have seen
// work. CI's supabase/setup-cli@v3 still resolves `latest` (2.119.0 when this
// pin was set, 2026-10-05) — bump this pin when CI's latest moves on and the
// suite stays green on it. Hashes are from the release's checksums.txt.
export const SUPABASE_CLI = {
  version: '2.119.0',
  sha256: {
    'linux-x64': 'bf1c3ae93be98533eb8a3105dbf4564bd0b2d9dc24690d8a920f980ef975c1b4',
    'linux-arm64': '3f552f0a3af30fe577c2820df09506a0e1233256441246b0850ed60806ff319d',
  },
  installPath: '/usr/local/bin/supabase',
};

const GOARCH = { x64: 'amd64', arm64: 'arm64' };

/** Release asset for this platform, or null when there is no pinned hash for it. */
export function cliAsset(platform, arch, cli = SUPABASE_CLI) {
  const sha256 = cli.sha256[`${platform}-${arch}`];
  if (!sha256) return null;
  const file = `supabase_${cli.version}_${platform}_${GOARCH[arch]}.tar.gz`;
  return {
    file,
    sha256,
    url: `https://github.com/supabase/cli/releases/download/v${cli.version}/${file}`,
  };
}

/** `supabase --version` output → "2.119.0", or null. */
export function parseSupabaseVersion(output) {
  if (typeof output !== 'string') return null;
  const m = output.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

/**
 * `supabase status -o env` output → { KEY: value }. Empty object if nothing parses.
 * @returns {Record<string, string>}
 */
export function parseStatusEnv(output) {
  /** @type {Record<string, string>} */
  const env = {};
  if (typeof output !== 'string') return env;
  for (const line of output.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const LOCAL_HOST = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/;

/**
 * Where an existing .env.local points: 'absent' | 'local' | 'remote'.
 * 'remote' is the main checkout's prod-pointing file — the stack step must
 * never overwrite it, and must never let a dev helper read creds from it.
 */
export function classifyEnvLocal(content) {
  if (content === null || content === undefined) return 'absent';
  const url = parseStatusEnv(content).NEXT_PUBLIC_SUPABASE_URL;
  return url && LOCAL_HOST.test(url) ? 'local' : 'remote';
}

/**
 * Decide every step from gathered facts. Returns
 *   { actions: [{ step, run: boolean, why }], blockers: string[], warnings: string[] }
 * Steps, in order: dockerd, cli, start, env, mfa (the last only with --dev-mfa). A step with run:false is
 * either already satisfied or blocked (then a blocker explains it); once any
 * blocker exists, every later step that needs the stack is held back.
 *
 * facts: {
 *   remote          CLAUDE_CODE_REMOTE === 'true'
 *   startDocker     --start-docker passed (explicit opt-in off the cloud)
 *   isRoot          uid 0
 *   platform, arch  process.platform / process.arch
 *   dockerUp        `docker info` succeeds
 *   dockerdPresent  a dockerd binary is on PATH
 *   cliVersion      parsed `supabase --version`, or null when absent
 *   stackRunning    `supabase status` reports a running stack
 *   envLocal        classifyEnvLocal() of the current .env.local
 *   devMfa          --dev-mfa passed (stamp seed TOTP + platform flag for UI passes)
 * }
 */
export function planStack(facts, cli = SUPABASE_CLI) {
  const actions = [];
  const blockers = [];
  const warnings = [];

  // 1. docker daemon
  if (facts.dockerUp) {
    actions.push({ step: 'dockerd', run: false, why: 'docker daemon already up' });
  } else if (!(facts.remote || facts.startDocker)) {
    actions.push({ step: 'dockerd', run: false, why: 'not started off the cloud' });
    blockers.push(
      'docker daemon unreachable. Start Docker Desktop / OrbStack / colima yourself — ' +
        'this step never starts a daemon on a laptop (pass --start-docker on a ' +
        'disposable root Linux box if that is what this is).'
    );
  } else if (facts.platform !== 'linux' || !facts.isRoot) {
    actions.push({ step: 'dockerd', run: false, why: 'needs root on Linux' });
    blockers.push(
      `docker daemon unreachable and cannot be started here (platform ${facts.platform}, ` +
        `${facts.isRoot ? 'root' : 'not root'}) — start it yourself, then re-run.`
    );
  } else if (!facts.dockerdPresent) {
    actions.push({ step: 'dockerd', run: false, why: 'no dockerd binary' });
    blockers.push('docker daemon unreachable and no dockerd binary on PATH — install docker, then re-run.');
  } else {
    actions.push({ step: 'dockerd', run: true, why: 'docker daemon down — starting dockerd' });
  }

  // 2. Supabase CLI
  if (facts.cliVersion === cli.version) {
    actions.push({ step: 'cli', run: false, why: `supabase CLI ${cli.version} (pinned) present` });
  } else if (facts.remote) {
    const asset = cliAsset(facts.platform, facts.arch, cli);
    if (asset) {
      actions.push({
        step: 'cli',
        run: true,
        why:
          facts.cliVersion === null
            ? `supabase CLI missing — installing pinned ${cli.version}`
            : `supabase CLI ${facts.cliVersion} ≠ pinned ${cli.version} — installing ${cli.version}`,
      });
    } else {
      actions.push({ step: 'cli', run: false, why: 'no pinned asset for this platform' });
      blockers.push(`no pinned supabase CLI hash for ${facts.platform}-${facts.arch} — add one to SUPABASE_CLI.`);
    }
  } else if (facts.cliVersion === null) {
    actions.push({ step: 'cli', run: false, why: 'not installed off the cloud' });
    blockers.push(
      `supabase CLI not installed. Install it yourself (e.g. \`brew install supabase/tap/supabase\`; ` +
        `the cloud pin is ${cli.version}) — this step never writes binaries on a laptop.`
    );
  } else {
    // A laptop CLI that is not the pin still works in practice (CI runs
    // `latest`) — say so, do not refuse.
    actions.push({ step: 'cli', run: false, why: `using local supabase CLI ${facts.cliVersion}` });
    warnings.push(`supabase CLI ${facts.cliVersion} ≠ the cloud pin ${cli.version}; fine unless a suite disagrees with CI.`);
  }

  const held = () => blockers.length > 0;

  // 3. supabase start
  if (facts.stackRunning) {
    actions.push({ step: 'start', run: false, why: 'local Supabase stack already running' });
  } else if (held()) {
    actions.push({ step: 'start', run: false, why: 'held back by the blockers above' });
  } else {
    actions.push({ step: 'start', run: true, why: 'stack not running — supabase start (first run pulls images: minutes)' });
  }

  // 4. .env.local — dev-env.mjs never overwrites an existing one, and neither do we.
  if (facts.envLocal === 'absent') {
    actions.push(
      held()
        ? { step: 'env', run: false, why: 'held back by the blockers above' }
        : { step: 'env', run: true, why: '.env.local absent — writing it from the running stack' }
    );
  } else {
    actions.push({ step: 'env', run: false, why: `existing .env.local (${facts.envLocal}) left untouched` });
    if (facts.envLocal === 'remote') {
      warnings.push(
        '.env.local points at a NON-local Supabase (prod?). The stack is up, but `pnpm dev` and ' +
          'e2e in this checkout will use that file — run them from a worktree without it.'
      );
    }
  }

  // 5. dev-mfa — opt-in. It flags admin@ as a platform admin, and pgTAP relies
  //    on admin@ NOT being one (CLAUDE.md "Platform admins"): measured
  //    2026-10-05, a dev-mfa'd stack fails 6 pgTAP files. The default stack is
  //    CI's lint-and-test stack (db:test, e2e:smoke); --dev-mfa is the
  //    layout-suite / UI-test-pass stack.
  if (!facts.devMfa) {
    actions.push({ step: 'mfa', run: false, why: 'dev-mfa not requested (pass --dev-mfa for e2e:layout / admin@ dev-login)' });
  } else if (held()) {
    actions.push({ step: 'mfa', run: false, why: 'held back by the blockers above' });
  } else {
    actions.push({ step: 'mfa', run: true, why: 'stamp seed TOTP + platform flag (idempotent; db:test then needs a reset)' });
  }

  return { actions, blockers, warnings };
}

/**
 * What the seed state means for the suites. `stamped` = admin@ carries the
 * platform-admin flag (dev-mfa ran since the last reset); null = unknown.
 */
export function seedStateNote(stamped) {
  if (stamped === true) {
    return (
      'dev-mfa state (admin@ is a platform admin): e2e:layout + admin@ dev-login work; ' +
      'db:test FAILS on this stack until `supabase db reset` (pgTAP needs admin@ unflagged).'
    );
  }
  if (stamped === false) {
    return 'CI state (seed as-is): db:test, db:test:concurrency, e2e:smoke run as in CI; e2e:layout needs `pnpm dev:mfa` first.';
  }
  return 'could not read the seed state — run `pnpm db:test` on a freshly reset stack.';
}
