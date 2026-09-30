/**
 * The live matcher from src/middleware.ts, compiled the way Next compiles it.
 * Shared by every guard that asserts which paths the middleware sees, so a
 * matcher edit cannot pass one test and fail another because the two model
 * different regexes for the same source line.
 *
 * Assert on the behaviour of the real pattern rather than on a substring:
 * `toContain('sw.js')` was satisfied by the explanatory COMMENT above the
 * matcher, so deleting the exclusion itself would have kept CI green.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function middlewareMatcher(): RegExp {
  const src = readFileSync(resolve(process.cwd(), 'src/middleware.ts'), 'utf8');
  const line = /matcher:\s*\[\s*'([^']+)'/.exec(src);
  if (!line) throw new Error('middleware matcher not found');
  // Unescape the JS string literal (`\\.` in source is `\.` at runtime).
  return new RegExp(`^${line[1].replace(/\\\\/g, '\\')}$`);
}
