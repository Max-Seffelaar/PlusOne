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
