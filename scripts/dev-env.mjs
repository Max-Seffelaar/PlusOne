// Auto-provision .env.local AND launch the dev server on a per-worktree port.
//
// Every git worktree is a separate checkout with its own node_modules and its own
// dev server, but they all share ONE local Supabase stack (fixed 553xx ports,
// keyed by supabase/config.toml). Three things used to bite a fresh/parallel session:
//   1. a missing .env.local — fixed by auto-writing it from the running stack;
//   2. port-7000 collisions — when a second worktree ran `pnpm dev`, Next silently
//      fell back to 7001, but the dev-login links all say :7000, so you'd land on
//      the wrong branch's server (the "one had mock data, one didn't" trap). Now
//      each worktree claims a STABLE port (7000 if free, else a deterministic 70xx)
//      and prints its OWN dev-login links — never a silent collision.
//   3. invite mail linking to prod — NEXT_PUBLIC_APP_URL is written for the port
//      it serves on (and a stale localhost port is corrected at serve time), so a
//      locally minted /auth/confirm token lands on this server, not on prod.
//
// Modes:
//   node scripts/dev-env.mjs           → provision .env.local only (used by `dev:env`)
//   node scripts/dev-env.mjs --serve   → provision, pick a port, print links, run next dev
//   PORT=7005 node scripts/dev-env.mjs --serve → force a specific port
//   DEV_WEBPACK=1 pnpm dev             → escape hatch: serve with webpack instead of Turbopack
//
// Never blocks: any env problem prints guidance and continues (next dev still runs).
import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { APP_URL_KEY, appUrlAdvice, envLocalBody } from './lib/dev-app-url.mjs';

const cwd = process.cwd();
const envPath = resolve(cwd, '.env.local');
const SEED_USERS = ['manager', 'staff', 'door']; // the no-MFA seed users

/** Writes .env.local when absent. For an existing one (never rewritten), returns
 *  the NEXT_PUBLIC_APP_URL to hand `next dev` instead, or null. */
function provisionEnv(port) {
  if (existsSync(envPath)) {
    // respect an existing env file (e.g. main → prod)
    const advice = appUrlAdvice(readFileSync(envPath, 'utf8'), port);
    if (advice.hint) console.log(advice.hint);
    if (advice.note) console.log(advice.note);
    return advice.override ?? null;
  }

  let raw;
  try {
    raw = execSync('supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    console.warn(
      '\n[dev-env] No running local Supabase stack found.\n' +
        '          Start the shared stack once with `pnpm supabase:start` (or `pnpm db:fresh`), then re-run.\n'
    );
    return;
  }

  const get = (key) => {
    const m = raw.match(new RegExp(`^${key}="?([^"\\n]+)"?`, 'm'));
    return m ? m[1] : '';
  };
  const url = get('API_URL');
  const anon = get('ANON_KEY');
  const service = get('SERVICE_ROLE_KEY');
  if (!url || !anon) {
    console.warn('[dev-env] Could not parse `supabase status -o env`; skipping .env.local generation.');
    return;
  }

  writeFileSync(envPath, envLocalBody({ url, anon, service, port }), 'utf8');
  console.log(`[dev-env] Wrote .env.local -> ${url} (shared local Supabase), app on port ${port}.`);
  return null;
}

/** True if nothing is listening on `port` (probe a short-lived 127.0.0.1 bind). */
function isPortFree(port) {
  return new Promise((res) => {
    const srv = createServer();
    srv.once('error', () => res(false));
    srv.once('listening', () => srv.close(() => res(true)));
    srv.listen(port, '127.0.0.1');
  });
}

// Stable per-worktree port in 7001..7099, derived from the checkout path so the
// same worktree always lands on the same port (no surprise reshuffling).
function worktreePort() {
  let h = 0;
  for (let i = 0; i < cwd.length; i++) h = (h * 31 + cwd.charCodeAt(i)) >>> 0;
  return 7001 + (h % 99);
}

async function choosePort() {
  if (process.env.PORT) return Number(process.env.PORT);
  if (await isPortFree(7000)) return 7000; // canonical owner when free (test worktree)
  const start = worktreePort();
  for (let i = 0; i < 99; i++) {
    const p = 7001 + ((start - 7001 + i) % 99);
    if (await isPortFree(p)) return p;
  }
  return 7000; // give up; next will report the conflict itself
}

function printBanner(port) {
  const links = SEED_USERS.map(
    (u) => `    http://localhost:${port}/auth/dev-login?email=${u}@plusone.test&next=/app`
  ).join('\n');
  const note =
    port === 7000
      ? ''
      : '  (port 7000 is busy — another session owns it; this worktree has its own stable port)';
  console.log(
    `\n[dev-env] Serving this worktree on http://localhost:${port}${note}\n` +
      `[dev-env] Dev-login (no MFA — manager/staff/door):\n${links}\n`
  );
}

const serve = process.argv.includes('--serve');
// Without --serve (`pnpm dev:env`, CI, `pnpm stack`) no server starts here, so
// the URL is written for PORT or 7000; `pnpm dev` corrects it per run below.
const port = serve ? await choosePort() : Number(process.env.PORT) || 7000;

let appUrlOverride = null;
try {
  appUrlOverride = provisionEnv(port);
} catch (e) {
  console.warn('[dev-env] Unexpected env error; continuing:', e?.message ?? e);
}

// The webpack build cache under .next/cache grows unbounded (~745 MB after one
// `pnpm build`) and Turbopack dev never reads it. Prune it at dev startup once it
// crosses the cap — the next `pnpm build` simply regenerates it. Never blocks.
const CACHE_CAP_MB = 500;

function dirSizeMb(dir) {
  let bytes = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try {
          bytes += statSync(full).size;
        } catch {
          /* file vanished mid-walk */
        }
      }
    }
  }
  return bytes / (1024 * 1024);
}

function pruneNextCache() {
  const cacheDir = resolve(cwd, '.next', 'cache');
  if (!existsSync(cacheDir)) return;
  const sizeMb = dirSizeMb(cacheDir);
  if (sizeMb <= CACHE_CAP_MB) return;
  try {
    rmSync(cacheDir, { recursive: true, force: true });
    console.log(
      `[dev-env] Pruned .next/cache (${Math.round(sizeMb)} MB > ${CACHE_CAP_MB} MB cap — build cache regenerates on the next \`pnpm build\`).`
    );
  } catch (e) {
    console.warn('[dev-env] Could not prune .next/cache; continuing:', e?.message ?? e);
  }
}

if (serve) {
  printBanner(port);
  try {
    pruneNextCache();
  } catch (e) {
    console.warn('[dev-env] Cache prune check failed; continuing:', e?.message ?? e);
  }
  const nextBin = resolve(cwd, 'node_modules', 'next', 'dist', 'bin', 'next');
  // Turbopack (measured 11/8, task 86ey9e9zd): cold /app compile 2.4s vs 9.4s
  // webpack, HMR 20–250ms vs 550–2000ms. DEV_WEBPACK=1 falls back to webpack.
  const args = [nextBin, 'dev', '-p', String(port)];
  if (!process.env.DEV_WEBPACK) args.splice(2, 0, '--turbopack');
  // PORT feeds the mail origin fallback (src/features/mail/send.ts appUrl); a
  // NEXT_PUBLIC_APP_URL set in the shell always wins over the correction.
  const env = { ...process.env, PORT: String(port) };
  if (appUrlOverride && !process.env[APP_URL_KEY]) env[APP_URL_KEY] = appUrlOverride;
  const child = spawn(process.execPath, args, { stdio: 'inherit', env });
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  process.exit(0);
}
