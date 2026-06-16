import type { Metadata } from 'next';
import Link from 'next/link';
import { getMyMemberships } from '@/lib/auth/memberships';
import { getManageableEvents } from '@/features/events/queries';
import { FirstEventEmpty } from '@/features/onboarding/components/FirstEventEmpty';
import { Icon } from '@/components/po/icon';
import { DCard } from '@/components/po/desktop/kit';

export const metadata: Metadata = {
  title: 'PLUSONE — Dashboard',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Concept',
  open: 'Open',
  live: 'Live',
  closed: 'Gesloten',
};

// Dashboard home. The (app) layout provides the sidebar shell + the onboarding
// gate, so this only renders content. Fresh venue with no events → the empty
// state; otherwise a real events overview (the full KPI dashboard is the
// dashboard-live-wiring phase).
export default async function DashboardPage(): Promise<JSX.Element> {
  const events = await getManageableEvents();

  if (events.length === 0) {
    const memberships = await getMyMemberships();
    return <FirstEventEmpty venueName={memberships[0]?.venueName ?? 'Je venue'} />;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="m-0 font-display text-[26px] font-extrabold tracking-[-0.02em] text-text">
          Dashboard
        </h1>
        <Link
          href="/events/new"
          className="inline-flex items-center gap-2 rounded-[12px] border border-transparent bg-acc px-[16px] py-[10px] font-display text-[14px] font-bold tracking-[-0.01em] text-on-acc transition-[filter,transform] hover:brightness-[1.08] active:scale-[0.985]"
        >
          <Icon name="cal" size={17} sw={2.1} />
          Nieuw event
        </Link>
      </div>

      <div className="mb-3 font-body text-[12px] font-bold uppercase tracking-[0.04em] text-faint">
        Events
      </div>
      <div className="flex flex-col gap-[10px]">
        {events.map((e) => {
          const live = e.status === 'live';
          return (
            <Link key={e.id} href={`/events/${e.id}`}>
              <DCard className="flex items-center gap-4 p-[16px] hover:brightness-[1.06]">
                <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] border border-line bg-elev2 text-dim">
                  <Icon name="cal" size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[16px] font-bold text-text">{e.name}</div>
                  <div className="text-[13px] text-faint">
                    {e.venueName} ·{' '}
                    {new Date(e.startsAt).toLocaleDateString('nl-NL', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </div>
                </div>
                <span
                  className={
                    live
                      ? 'inline-flex items-center gap-[6px] rounded-[8px] bg-acc-dim px-[10px] py-[5px] font-body text-[12px] font-bold text-acc'
                      : 'inline-flex items-center rounded-[8px] border border-line px-[10px] py-[5px] font-body text-[12px] font-bold text-dim'
                  }
                >
                  {live && <span className="h-[7px] w-[7px] rounded-full bg-acc" />}
                  {STATUS_LABEL[e.status] ?? e.status}
                </span>
              </DCard>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
