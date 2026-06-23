import { en } from './en';
import { door } from './surfaces/door';
import { cockpit } from './surfaces/cockpit';
import { home } from './surfaces/home';
import { events } from './surfaces/events';
import { guests } from './surfaces/guests';
import { settings } from './surfaces/settings';
import { onboarding } from './surfaces/onboarding';
import { requests } from './surfaces/requests';
import { audit } from './surfaces/audit';
import { analytics } from './surfaces/analytics';
import { auth } from './surfaces/auth';
import { landing } from './surfaces/landing';
import { shared } from './surfaces/shared';

/**
 * Active UI dictionary — the composed "message catalogus". EN-only for now; to add
 * a locale, build a sibling composition and switch here (by user/venue preference).
 * Components import `t` and read static, typed copy: `t.nav.home`, `t.door.checkin`.
 * Use `fmt` for strings with {placeholders}.
 *
 * `en` holds the app-shell base (common / nav / venue + the 3 door-tab titles);
 * each screen surface lives in ./surfaces/* and is composed in below. The door
 * surface is merged onto the base so the shell's titles and the component strings
 * share one `t.door`.
 */
export const t = {
  ...en,
  door: { ...en.door, ...door },
  cockpit,
  home,
  events,
  guests,
  settings,
  onboarding,
  requests,
  audit,
  analytics,
  auth,
  landing,
  shared,
};

/** Fill {placeholders} in a copy string. Unknown keys are left as `{key}`. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}
