/**
 * Standalone screens keep clear of the system bars (Android edge-to-edge,
 * iPhone notch). The root layout sets `viewportFit: 'cover'`, so a full-screen
 * route outside the `/app` shell draws under the status bar and the navigation
 * bar unless it pads the safe-area insets itself — Max's Android test of the
 * onboarding Team step showed the footer buttons under the 3-button bar and the
 * step header under the status bar. Every such route goes through
 * `safeAreaPadding` (src/lib/po/safe-area.ts).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeAreaPadding } from '@/lib/po/safe-area';

const root = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');

const STANDALONE_SCREENS = [
  'src/features/onboarding/components/WizardShell.tsx',
  'src/features/onboarding/components/steps/WelkomStep.tsx',
  'src/features/onboarding/components/steps/InviteStep.tsx',
  'src/features/auth/components/ConsentScreen.tsx',
  'src/app/login/page.tsx',
  'src/app/mfa/layout.tsx',
  'src/app/door/page.tsx',
  'src/app/not-found.tsx',
];

describe('safeAreaPadding', () => {
  it('adds each inset to the screen\'s own padding', () => {
    expect(safeAreaPadding(40, 24)).toEqual({
      paddingTop: 'calc(40px + var(--safe-top))',
      paddingRight: 'calc(24px + var(--safe-right))',
      paddingBottom: 'calc(40px + var(--safe-bottom))',
      paddingLeft: 'calc(24px + var(--safe-left))',
    });
  });

  it('one value pads all four sides', () => {
    expect(Object.values(safeAreaPadding(0))).toEqual([
      'calc(0px + var(--safe-top))',
      'calc(0px + var(--safe-right))',
      'calc(0px + var(--safe-bottom))',
      'calc(0px + var(--safe-left))',
    ]);
  });
});

describe('standalone full-screen routes pad the safe area', () => {
  it.each(STANDALONE_SCREENS)('%s', (file) => {
    const src = read(file);
    expect(src).toContain("from '@/lib/po/safe-area'");
    expect(src).toMatch(/style=\{[^}]*safeAreaPadding\(/);
  });
});
