'use client';

/**
 * Responsive app-shell (S0 nav-shell, design `resp-app.jsx`). One shell, two
 * chromes: a desktop sidebar at ≥1024px, the mobile bottom-tab bar below it —
 * identical content in between. Built with the real `po` kit + design tokens.
 *
 * Tablet (641–1023px, T1 — design-system.md "Breakpoints & tablet"): there is
 * deliberately NO third chrome. iPad portrait stays in the bottom-tab chrome
 * (a 252px sidebar would leave a phone-width 516–582px column, and the same
 * switch picks the door's offline outbox variant). What changes above the
 * phone width is the CONTENT column: `mainMaxClass` caps it in both chromes,
 * so a form screen reads at the same 640px column on an iPad as on a laptop,
 * and a wide screen gets the full width. On a phone the cap is a no-op.
 */
import { Fragment, type JSX, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Icon, type IconName } from './icon';
import { TabBar, type TabKey } from './shell';
import { useViewport } from './use-viewport';

/** Safe-area insets for the shell ROOT, applied once for both chromes. N1
 *  (#331) sets `viewportFit: 'cover'` and the installed iOS PWA already runs
 *  `black-translucent`, so the page draws under the status bar/notch/Dynamic
 *  Island and these `env()` values are real (0 in a plain desktop browser).
 *  Top + sides only: the BOTTOM inset is already owned by whatever sits at the
 *  bottom edge — `TabBar`, `BottomBar`, `Sheet` (shell.tsx) and the desktop
 *  sidebar footer below — and padding the root too would count it twice.
 *  Exported for the test only (jsdom's style parser drops a bare `env()`). */
export const ROOT_SAFE_AREA = {
  paddingTop: 'env(safe-area-inset-top)',
  paddingLeft: 'env(safe-area-inset-left)',
  paddingRight: 'env(safe-area-inset-right)',
} as const;

export interface ShellNavItem {
  key: string;
  label: string;
  icon: IconName;
  active: boolean;
  onClick: () => void;
  /** Desktop grouping: 'main' = the primary tabs, 'more' = promoted More items
   *  (Analytics/Team/…) shown below a divider since the sidebar has the room. */
  section?: 'main' | 'more';
  /** Count pill on the right of the row (e.g. open requests) — omitted/0 hides it. */
  badge?: number;
}

export function ResponsiveShell({
  serverHint,
  isTabRoot,
  mobileTab,
  setMobileTab,
  mobileBadges,
  mobileTabs,
  navItems,
  venueName,
  venueSub,
  venueOpensSettings = false,
  onOpenVenue,
  onOpenProfile,
  userName,
  userSub,
  mainMaxClass = 'max-w-[640px]',
  children,
}: {
  serverHint: boolean;
  isTabRoot: boolean;
  mobileTab: TabKey;
  setMobileTab: (t: TabKey) => void;
  mobileBadges?: Partial<Record<TabKey, number>>;
  /** Which bottom tabs to show (default all); non-door roles drop Deur/Taken. */
  mobileTabs?: readonly TabKey[];
  navItems: ShellNavItem[];
  venueName: string;
  venueSub?: string;
  /** The venue card opens venue settings (one venue) rather than the switcher:
   *  a chevron-right instead of the dropdown chevron (z8uq9m0hw2). */
  venueOpensSettings?: boolean;
  onOpenVenue: () => void;
  /** Open the signed-in user's profile settings (desktop footer click, T10). */
  onOpenProfile: () => void;
  userName: string;
  userSub: string;
  /** Content-column width (Tailwind max-w-* class), applied in BOTH chromes:
   *  wide dashboard screens (home) opt into more than the default reading
   *  column. Below 641px it never bites (the viewport is narrower); on a
   *  tablet in the bottom-tab chrome it centers the same column desktop uses. */
  mainMaxClass?: string;
  children: ReactNode;
}): JSX.Element {
  const isMobile = useViewport(serverHint);

  // ONE tree for both chromes (N6 review): `children` sits at the same element
  // path — root div > main > div > children — whether the chrome is the bottom
  // tabs or the sidebar. Two separate returns put it at different positions, so
  // every flip at 1024px (an iPad rotated mid-shift, a first load whose UA seed
  // `useViewport` corrects, a window resized across the breakpoint) unmounted
  // and remounted the whole screen, the door's `DoorProvider` and its outbox
  // state included (#25). Only the chrome around the slot changes: the sidebar
  // is a conditional sibling BEFORE it, the tab bar one AFTER it, and the
  // wrappers' classes switch. Guarded by `shell-door-mount.test.tsx`.
  //
  // Mobile + tablet: bottom tab bar. Full-bleed on a phone; from 641px the
  // content column is centered at the screen's own width class (T1).
  // Desktop (and iPad landscape): 252px sidebar + content column.
  // The root pads for the top/side safe area (status bar, notch, landscape phone).
  return (
    <div
      className={cn('flex h-[100dvh] overflow-hidden bg-bg', isMobile && 'flex-col')}
      style={ROOT_SAFE_AREA}
    >
      {/* The sidebar is its own bottom edge (the profile card sits on it), so
          it — not the root — clears the iPad home indicator. The content
          column's own `BottomBar` handles its side. */}
      {!isMobile && (
        <aside
          className="flex w-[252px] flex-none flex-col border-r border-line2 bg-bg px-4 pt-[22px]"
          style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center gap-[11px] px-2 pb-[22px]">
            <div className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-acc font-display text-[17px] font-extrabold tracking-[-0.03em] text-on-acc">
              +1
            </div>
            <div className="font-display text-[19px] font-extrabold tracking-[-0.02em] text-text">
              plusone
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenVenue}
            className="mb-[18px] flex w-full items-center gap-[10px] rounded-[12px] border border-line bg-elev p-[10px] text-left transition-[filter] hover:brightness-[1.07]"
          >
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] bg-acc font-display text-[13px] font-extrabold text-on-acc">
              {venueName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-[14px] font-bold text-text">
                {venueName}
              </span>
              {venueSub ? (
                <span className="block truncate text-[11px] text-faint">{venueSub}</span>
              ) : null}
            </span>
            <Icon name={venueOpensSettings ? 'chev' : 'chevD'} size={16} className="text-ghost" />
          </button>

          <nav className="po-scroll flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto">
            {navItems.map((it, i) => (
              <Fragment key={it.key}>
                {it.section === 'more' && navItems[i - 1]?.section !== 'more' && (
                  <div className="mx-3 my-2 h-px bg-line2" />
                )}
                <button
                  type="button"
                  onClick={it.onClick}
                  className={cn(
                    'flex w-full flex-none items-center gap-3 rounded-[12px] px-3 py-[11px] text-left font-display text-[14.5px] font-bold transition-[filter] hover:brightness-[1.1]',
                    it.active ? 'bg-acc-dim text-acc' : 'text-dim'
                  )}
                >
                  <Icon name={it.icon} size={19} sw={it.active ? 2.2 : 1.9} />
                  {it.label}
                  {it.badge != null && it.badge > 0 && (
                    <span className="ml-auto inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-acc px-[6px] font-body text-[11px] font-extrabold text-on-acc">
                      {it.badge}
                    </span>
                  )}
                </button>
              </Fragment>
            ))}
          </nav>

          <button
            type="button"
            onClick={onOpenProfile}
            aria-label={t.settings.profile.title}
            className="mt-3 flex w-full flex-none items-center gap-[11px] rounded-[12px] border border-line bg-elev p-[10px] text-left transition-[filter] hover:brightness-[1.1] active:scale-[0.99]"
          >
            <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-elev2 font-display text-[13px] font-bold text-text">
              {userName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-[13.5px] font-bold text-text">
                {userName}
              </span>
              <span className="flex items-center gap-1 truncate text-[11px] text-faint">
                <Icon name="shield" size={11} className="text-acc" />
                {userSub}
              </span>
            </span>
            <Icon name="chev" size={16} className="flex-none text-ghost" />
          </button>
        </aside>
      )}

      <main
        className={cn('flex flex-1 flex-col overflow-hidden', isMobile ? 'min-h-0' : 'min-w-0')}
      >
        <div
          className={cn(
            'relative mx-auto flex w-full flex-col overflow-hidden',
            isMobile ? 'min-h-0 flex-1' : 'h-full',
            mainMaxClass
          )}
        >
          {children}
        </div>
      </main>
      {isMobile && isTabRoot && (
        <TabBar tab={mobileTab} setTab={setMobileTab} badges={mobileBadges} show={mobileTabs} />
      )}
    </div>
  );
}
