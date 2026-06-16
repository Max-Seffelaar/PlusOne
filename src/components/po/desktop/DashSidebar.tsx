'use client';

/** Unified desktop app sidebar — the single shell for dashboard, events and the
 *  admin pages (replaces the old header nav). Dumb: the (app) layout computes the
 *  venue/user/nav from real data and passes it in; this just renders + highlights
 *  the active route. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Icon, type IconName } from '../icon';
import { Avatar } from '../kit';
import { SignOutButton } from '@/features/auth/components/SignOutButton';
import { VenueSwitcher, type SwitcherVenue } from '@/features/venues/components/VenueSwitcher';

export interface SidebarNavItem {
  href: string;
  label: string;
  icon: IconName;
}

const press = 'transition-[filter,transform,background,border-color,color] hover:brightness-[1.08] active:scale-[0.985]';

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashSidebar({
  venueName,
  userName,
  nav,
  venues,
  activeVenueId,
}: {
  venueName: string;
  userName: string;
  nav: SidebarNavItem[];
  venues: SwitcherVenue[];
  activeVenueId: string | null;
}): JSX.Element {
  const pathname = usePathname();

  return (
    <aside className="flex h-[100dvh] w-[250px] shrink-0 flex-col border-r border-line2 bg-bg px-4 py-[22px]">
      <div className="flex items-center gap-[11px] px-2 pb-[18px]">
        <div className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-acc font-display text-[17px] font-extrabold tracking-[-0.03em] text-on-acc">
          +1
        </div>
        <div className="font-display text-[19px] font-extrabold tracking-[-0.02em] text-text">
          plusone
        </div>
      </div>

      <Link
        href="/admin/venue"
        className={cn(
          'flex w-full items-center gap-[10px] rounded-[12px] border border-line bg-elev p-[10px] text-left text-text',
          press
        )}
      >
        <Avatar name={venueName} size={30} accent />
        <div className="min-w-0 flex-1">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[14px] font-bold">
            {venueName}
          </div>
          <div className="text-[11px] text-faint">Venue beheren</div>
        </div>
      </Link>

      {venues.length > 1 && (
        <div className="mt-[10px]">
          <VenueSwitcher venues={venues} activeVenueId={activeVenueId} />
        </div>
      )}

      <div className="px-[10px] pb-2 pt-[18px] font-body text-[12px] font-bold uppercase tracking-[0.04em] text-faint">
        Menu
      </div>
      <nav className="flex flex-col gap-[3px]">
        {nav.map((item) => {
          const on = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex w-full items-center gap-3 whitespace-nowrap rounded-[12px] px-3 py-[11px] text-left font-display text-[14.5px] font-bold',
                on
                  ? 'bg-acc-dim text-acc'
                  : 'bg-transparent text-dim transition-colors hover:bg-elev hover:text-text'
              )}
            >
              <Icon name={item.icon} size={19} sw={on ? 2.2 : 1.9} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />
      <div className="flex items-center gap-[11px] rounded-[12px] border border-line bg-elev p-[10px]">
        <Avatar name={userName} size={34} />
        <div className="min-w-0 flex-1">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[13.5px] font-bold">
            {userName}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-faint">
            <Icon name="shield" size={11} stroke="#B5A6FF" />
            Account
          </div>
        </div>
        <SignOutButton />
      </div>
    </aside>
  );
}
