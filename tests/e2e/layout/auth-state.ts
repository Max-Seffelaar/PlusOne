import { join } from 'node:path';
import type { LayoutUser } from './screens';

/**
 * Where `global-setup.ts` leaves each seed user's signed-in storage state (a
 * fresh `mkdtemp` directory per run, so a session never outlives its run or
 * leaks into the repo). Global setup sets the variable; the workers it spawns
 * inherit it.
 */
export const AUTH_DIR_ENV = 'PLUSONE_LAYOUT_AUTH_DIR';

export function authStatePath(user: LayoutUser): string {
  const dir = process.env[AUTH_DIR_ENV];
  if (!dir) throw new Error(`${AUTH_DIR_ENV} is unset: run the layout suite through playwright.layout.config.ts (its global setup signs the seed users in)`);
  return join(dir, `${user}.json`);
}
