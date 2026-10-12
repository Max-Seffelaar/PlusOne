// Offline fallback for `pnpm supabase:gen`.
//
// Supabase CLI 2.10x requires a platform login for every `gen types` variant
// (including --local). Until `supabase login` has been run once, this script
// produces identical output by calling the typegen endpoint of the local
// pg-meta container directly. Requires `supabase start` to be running.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { supabaseContainer } from './lib/supabase-project.mjs';

// pg-meta container of THIS checkout's stack (supabase/config.toml project_id).
const CONTAINER = supabaseContainer('pg_meta', new URL('../supabase/config.toml', import.meta.url));
const TYPEGEN_URL =
  'http://localhost:8080/generators/typescript?included_schemas=public&detect_one_to_one_relationships=true';

const types = execFileSync(
  'docker',
  [
    'exec',
    CONTAINER,
    'node',
    '-e',
    `fetch('${TYPEGEN_URL}').then(r => r.text()).then(t => process.stdout.write(t))`,
  ],
  { maxBuffer: 64 * 1024 * 1024 }
);

if (!types.toString().startsWith('export type Json')) {
  console.error('Unexpected typegen output — is the local stack running? (pnpm supabase:start)');
  process.exit(1);
}

writeFileSync(new URL('../src/lib/database.types.ts', import.meta.url), types);
console.log('src/lib/database.types.ts generated via local pg-meta');
