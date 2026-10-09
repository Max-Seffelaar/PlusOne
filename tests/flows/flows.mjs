// QA-0 flow registry: which changed paths make CI run which flow.
//
// A flow runs in the `flow-shots` CI job when a PR touches one of its own
// `paths`, its own `tests/flows/<name>.flow.ts`, or any SHARED path (the harness
// itself, the stack, the shell every flow walks through). A PR that touches
// none — README, docs, an unrelated feature — runs no flow at all.
//
// Matching is by prefix on repo-relative paths: a trailing `/` is a directory,
// anything else a file or file-name prefix (`src/components/po/app` covers
// app.tsx, app-chrome.tsx, app-screens.tsx, …). Plain .mjs so the selector in
// scripts/flow-shots/select.mjs reads it without a TypeScript step.
//
// Adding a flow: write tests/flows/<name>.flow.ts and add an entry here —
// `select.mjs --self-check` (first step of the CI job) fails on a flow file
// without an entry and on an entry without a flow file.

/** Paths every flow depends on. */
export const SHARED_PATHS = [
  // the harness
  'tests/flows/harness.ts',
  'tests/flows/playwright.config.ts',
  'tests/flows/flows.mjs',
  'scripts/flow-shots/',
  'tests/e2e/layout/matrix.ts',
  'tests/e2e/helpers/',
  'playwright.config.ts',
  '.github/workflows/ci.yml',
  // toolchain + stack
  'package.json',
  'pnpm-lock.yaml',
  'next.config.js',
  'tailwind.config.ts',
  'supabase/migrations/',
  'supabase/seed.sql',
  'supabase/config.toml',
  'scripts/dev-env.mjs',
  'scripts/dev-mfa.mjs',
  // the shell and the seams every flow passes through
  'src/middleware.ts',
  'src/app/layout.tsx',
  'src/app/globals.css',
  'src/app/app/',
  'src/app/auth/dev-login/',
  'src/lib/i18n/',
  'src/lib/supabase/',
  'src/lib/platform.ts',
  'src/lib/use-native-shell.ts',
  'src/components/po/app',
  'src/components/po/shell',
  'src/components/po/kit.tsx',
  'src/components/po/icon.tsx',
  'src/components/po/context.tsx',
  'src/components/po/routes.ts',
  'src/components/po/nav-map.ts',
];

/** @type {Record<string, { title: string; paths: string[] }>} */
export const FLOWS = {
  onboarding: {
    title: 'Onboarding — new owner, consent → wizard → app → billing',
    paths: [
      'src/app/onboarding/',
      'src/app/consent/',
      'src/features/onboarding/',
      'src/features/auth/',
      'src/features/billing/',
      'src/features/venues/',
      'src/components/po/screens/onboarding',
      'src/components/po/screens/home',
      'src/components/po/screens/settings',
    ],
  },
  'crew-existing-account': {
    title: 'Crew — an existing account is invited, accepts or declines per invite (Home banner, onboarding), sees only that event (#24); a new address gets the same mail',
    paths: [
      'src/components/po/screens/events/crew',
      'src/components/po/pending-invites-banner.tsx',
      'src/features/events/actions.ts',
      'src/features/auth/invite-actions.ts',
      // Q24-Q29: one invite mail (the mail a new address gets, its button).
      'src/features/auth/invite-mail.ts',
      'src/features/mail/',
      'src/app/auth/confirm/',
      'src/features/onboarding/components/steps/InviteStep',
      'src/app/onboarding/',
    ],
  },
  'team-crew-manage': {
    title: 'Team — an admin manages external crew per event: quota and remove from crew (z8uq9m2yvp)',
    paths: [
      'src/components/po/screens/settings/team',
      'src/components/po/screens/events/crew',
      'src/features/po/queries.ts',
      'src/features/po/adapters.ts',
      'src/features/po/mutations.ts',
      'src/features/events/actions.ts',
    ],
  },
  'last-admin-guard': {
    title: 'Team — the only admin cannot remove themselves or drop admin; a second admin lifts it; the API refuses with P0LA1 (task 0g)',
    paths: [
      'src/components/po/screens/settings/team',
      'src/components/po/screens/settings/_shared',
      'src/features/venues/',
      'src/features/po/mutations.ts',
      'src/lib/db-errors.ts',
      'supabase/migrations/20261012120000_last_admin_guard.sql',
    ],
  },
  'company-rename': {
    title: 'Venue → Company — copy sweep, Type options, per-event location → cards, detail, /e/[slug]',
    paths: [
      'src/features/onboarding/',
      'src/features/venues/',
      'src/features/events/',
      'src/features/po/',
      'src/components/po/screens/',
      'src/components/po/event-row.tsx',
      'src/components/po/landing',
      'src/app/e/',
      'src/app/onboarding/',
      // Q17 walks Save as template → create from template (the two RPCs).
      'supabase/migrations/20261007135000_template_location.sql',
    ],
  },
  'door-checkin': {
    title: 'Door check-in D — Check in all / Check in 1 (3/4), one row, undo refused with the setting off',
    paths: [
      'src/features/door/',
      'src/features/po/eventday/',
      'src/features/po/mutations.ts',
      'src/components/po/screens/door',
      'src/components/po/door-',
      'src/components/po/screens/settings/venue.tsx',
    ],
  },
  'door-tasks-tab': {
    title: 'Check-in — no Tasks view on either door variant (tab or cockpit card); an old ?seg=taken link lands on the list (z8uq9m2vg7)',
    paths: [
      'src/components/po/screens/door',
      'src/components/po/door-branch.tsx',
      'src/features/door/components/DoorRoute.tsx',
      'src/features/po/eventday/EventDayCockpit.tsx',
    ],
  },
  'native-shell-guard': {
    title: 'Native-shell guard — billing is status-only inside the app (#32/#37)',
    paths: [
      'src/features/billing/',
      'src/features/onboarding/',
      'src/components/po/screens/settings',
      'src/components/native-',
      'src/lib/native/',
      'capacitor.config.ts',
    ],
  },
  billing: {
    title: 'Billing G — More → Billing: one plan Pro, monthly / yearly, browser vs native, admin / finance / manager',
    paths: [
      'src/features/billing/',
      'src/features/po/',
      'src/components/po/screens/settings',
      'src/lib/auth/onboarding.ts',
    ],
  },
  'platform-overview': {
    title: 'Platform R — Overview numbers, invite company chip → Switch (access log), Companies detail',
    paths: [
      'supabase/migrations/20261012130000_platform_overview_rpcs.sql',
      'src/features/po/',
      'src/components/po/screens/platform',
      'src/lib/i18n/surfaces/platform.ts',
    ],
  },
  'platform-billing': {
    title: 'Billing G — Platform → Companies: always free / trial until, audited on the admin',
    paths: [
      'src/features/billing/',
      'src/features/po/',
      'src/components/po/screens/platform',
    ],
  },
};
