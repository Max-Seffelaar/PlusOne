'use client';

/**
 * Responsive app-shell (S0 nav-shell, design `resp-app.jsx`). One shell, two
 * chromes: a desktop sidebar at ≥1024px, the mobile bottom-tab bar below it —
 * identical content in between. Built with the real `po` kit + design tokens;
 * the screens rendered inside stay as-is for now (wired live per S1+).
 */
import { Fragment, type JSX, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Icon, type IconName } from './icon';
import { TabBar, type TabKey } from './shell';
import { useViewport } from './use-viewport';

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
  onOpenVenue: () => void;
  /** Open the signed-in user's profile settings (desktop footer click, T10). */
  onOpenProfile: () => void;
  userName: string;
  userSub: string;
  /** Desktop content-column width (Tailwind max-w-* class). Wide dashboard
   *  screens (home) opt into more than the default reading column. */
  mainMaxClass?: string;
  children: ReactNode;
}): JSX.Element {
  const isMobile = useViewport(serverHint);

  // Mobile: full-bleed content + the existing bottom tab bar (unchanged look).
  if (isMobile) {
    return (
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        {isTabRoot && <TabBar tab={mobileTab} setTab={setMobileTab} badges={mobileBadges} show={mobileTabs} />}
      </div>
    );
  }

  // Desktop: 252px sidebar + content column.
  return (
    <div className="flex h-[100dvh] overflow-hidden bg-bg">
      <aside className="flex w-[252px] flex-none flex-col border-r border-line2 bg-bg px-4 pb-4 pt-[22px]">
        <div className="flex items-center gap-[11px] px-2 pb-[22px]">
          <div className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-acc font-display text-[17px] font-extrabold tracking-[-0.03em] text-on-acc">
            +1
          </div>
          <div className="font-display text-[19px] font-extrabold tracking-[-0.02em] text-text">plusone</div>
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
            <span className="block truncate font-display text-[14px] font-bold text-text">{venueName}</span>
            {venueSub ? <span className="block truncate text-[11px] text-faint">{venueSub}</span> : null}
          </span>
          <Icon name="chevD" size={16} className="text-ghost" />
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
                  it.active ? 'bg-acc-dim text-acc' : 'text-dim',
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
            <span className="block truncate font-display text-[13.5px] font-bold text-text">{userName}</span>
            <span className="flex items-center gap-1 truncate text-[11px] text-faint">
              <Icon name="shield" size={11} className="text-acc" />
              {userSub}
            </span>
          </span>
          <Icon name="chev" size={16} className="flex-none text-ghost" />
        </button>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className={cn('relative mx-auto flex h-full w-full flex-col overflow-hidden', mainMaxClass)}>
          {children}
        </div>
      </main>
    </div>
  );
}
