// Shared logic for the two migration-collision guards (git pre-push hook +
// Claude Code PreToolUse hook). Pure functions only — no fs/git I/O — so they
// stay unit-testable without a real repo (see tests/unit/migration-guard.test.ts).

const TIMESTAMP_RE = /^(\d{14})_/;

export function timestampOf(filename) {
  const m = filename.match(TIMESTAMP_RE);
  return m ? m[1] : null;
}

// Local migrations that are NOT already on `remoteFiles` but share a 14-digit
// timestamp prefix with one that is — the collision class from CLAUDE.md
// "Conventions" (breaks `supabase db push` / `db reset`).
export function findTimestampCollisions(localFiles, remoteFiles) {
  const remoteSet = new Set(remoteFiles);
  const remoteTimestamps = new Map();
  for (const f of remoteFiles) {
    const ts = timestampOf(f);
    if (ts && !remoteTimestamps.has(ts)) remoteTimestamps.set(ts, f);
  }

  const collisions = [];
  for (const f of localFiles) {
    if (remoteSet.has(f)) continue;
    const ts = timestampOf(f);
    if (!ts) continue;
    const existing = remoteTimestamps.get(ts);
    if (existing && existing !== f) {
      collisions.push({ local: f, remote: existing });
    }
  }
  return collisions;
}

// True for a repo-relative, forward-slash path directly under supabase/migrations/.
export function isMigrationPath(relativePath) {
  return /^supabase\/migrations\/[^/]+\.sql$/.test(relativePath.replace(/\\/g, '/'));
}

// Any two (or more) files sharing a 14-digit timestamp prefix within a single
// list — the class that findTimestampCollisions cannot see: two branches can
// each independently pick a free timestamp and only collide once BOTH land on
// main (86ey9e84m/86ey9e851, 13/7 — neither PR's own branch had a duplicate,
// origin/main did after both merged). Self-contained: no git/origin dependency,
// so it works identically as a post-merge CI check on main.
export function findDuplicateTimestamps(files) {
  const byTimestamp = new Map();
  for (const f of files) {
    const ts = timestampOf(f);
    if (!ts) continue;
    if (!byTimestamp.has(ts)) byTimestamp.set(ts, []);
    byTimestamp.get(ts).push(f);
  }
  return [...byTimestamp.values()].filter((group) => group.length > 1);
}
