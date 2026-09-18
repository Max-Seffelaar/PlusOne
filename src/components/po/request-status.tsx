/** The /r/[token] guest status page (#28, #43(f); amended z8uq9m0hw6).
 *
 *  data=null is the neutral not-found: an invalid, revoked, anonymized or
 *  throttled token all render the identical "Nothing here." with no event info.
 *  For a found token the page shows the event and the night's window; an
 *  APPROVED request also gets the venue address, "Approved for X of Y" when the
 *  venue approved fewer than asked, and the venue's message. The adapter
 *  (`toRequestStatusView`) and the RPC both gate those fields on the state.
 *  The message is plain text rendered as a React text node, never as HTML.
 *  Read-only and explicitly NOT a ticket. No hooks: renders on the server. */
import type { JSX, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import type { RequestStatusData } from '@/features/requests/status-view';
import { Icon, type IconName } from './icon';
import { LandingFooter, LandingWrap } from './landing-frame';

function MetaChip({ icon, children, label }: { icon: IconName; children: ReactNode; label?: string }): JSX.Element {
  return (
    <div className="inline-flex max-w-full items-start gap-[7px] rounded-[11px] border border-line bg-elev px-[13px] py-2 text-left text-[13px] font-semibold leading-[1.35] text-dim">
      <Icon name={icon} size={15} className="mt-px shrink-0 text-faint" />
      <span className="min-w-0 break-words">
        {label && <span className="sr-only">{label}: </span>}
        {children}
      </span>
    </div>
  );
}

export function RequestStatus({ data }: { data: RequestStatusData | null }): JSX.Element {
  if (!data) {
    return (
      <LandingWrap>
        <div className="rounded-[24px] border border-line bg-elev px-[26px] py-[34px] text-center">
          <div className="mx-auto mb-5 flex h-[62px] w-[62px] items-center justify-center rounded-[20px] bg-elev2">
            <Icon name="warn" size={30} className="text-faint" />
          </div>
          <h1 className="m-0 mb-[10px] font-display text-[26px] font-extrabold tracking-[-0.02em]">{t.landing.statusNotFoundTitle}</h1>
          <p className="mx-auto max-w-[330px] text-[15px] leading-[1.55] text-dim">{t.landing.statusNotFoundBody}</p>
        </div>
        <LandingFooter />
      </LandingWrap>
    );
  }

  const heads = 1 + data.plusOnes;
  const approvedHeads = data.approvedPlusOnes != null ? 1 + data.approvedPlusOnes : null;
  const view = {
    pending: {
      icon: 'clock' as IconName,
      iconBg: 'bg-elev2',
      iconStroke: undefined,
      title: t.landing.statusPendingTitle,
      body: fmt(t.landing.statusPendingBody, { event: data.eventName }),
    },
    approved: {
      icon: 'check2' as IconName,
      iconBg: 'bg-acc',
      iconStroke: '#16132B',
      title: t.landing.statusApprovedTitle,
      body: fmt(t.landing.statusApprovedBody, { event: data.eventName, date: data.date }),
    },
    denied: {
      icon: 'warn' as IconName,
      iconBg: 'bg-elev2',
      iconStroke: undefined,
      title: t.landing.statusDeniedTitle,
      body: fmt(t.landing.statusDeniedBody, { event: data.eventName }),
    },
  }[data.status];

  return (
    <LandingWrap>
      <div className="mb-[22px] text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-acc-dim px-[13px] py-1.5">
          <div className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-acc font-display text-[12px] font-extrabold tracking-[-0.03em] text-on-acc">+1</div>
          <span className="font-body text-[12.5px] font-bold text-acc-soft">{fmt(t.landing.eyebrow, { event: data.eventName })}</span>
        </div>
        <h1 className="m-0 mt-4 break-words font-display text-[40px] font-extrabold leading-[0.98] tracking-[-0.03em]">{data.eventName}</h1>
        <div className="mt-[12px] flex flex-wrap items-center justify-center gap-[8px]">
          <MetaChip icon="cal">{data.date}</MetaChip>
          {data.time && <MetaChip icon="clock">{data.time}</MetaChip>}
          {data.address && (
            <MetaChip icon="pin" label={t.landing.statusAddressAria}>
              {data.address}
            </MetaChip>
          )}
        </div>
      </div>
      <div className="rounded-[24px] border border-line bg-elev px-[26px] py-[34px] text-center">
        <div className={cn('mx-auto mb-5 flex h-[62px] w-[62px] items-center justify-center rounded-[20px]', view.iconBg)}>
          <Icon name={view.icon} size={30} stroke={view.iconStroke} className={view.iconStroke ? undefined : 'text-faint'} sw={view.iconStroke ? 2.4 : undefined} />
        </div>
        <h2 className="m-0 mb-[10px] font-display text-[26px] font-extrabold tracking-[-0.02em]">{view.title}</h2>
        <p className="mx-auto max-w-[330px] text-[15px] leading-[1.55] text-dim">
          <b className="text-text">{data.fullName}</b>
          {approvedHeads != null ? (
            <span> · {fmt(t.landing.statusApprovedReduced, { approved: approvedHeads, requested: heads })}</span>
          ) : (
            heads > 1 && <span> · {fmt(t.landing.statusApprovedGroup, { n: heads })}</span>
          )}
        </p>
        <p className="mx-auto mt-[8px] max-w-[330px] text-[15px] leading-[1.55] text-dim">{view.body}</p>
        {data.message && (
          <div className="mt-[20px] rounded-[14px] border border-line bg-elev2 px-4 py-[13px] text-left">
            <div className="mb-[6px] font-body text-[11.5px] font-bold uppercase tracking-[0.04em] text-faint">{t.landing.statusMessageLabel}</div>
            <p className="m-0 whitespace-pre-line break-words text-[14.5px] leading-[1.5] text-text">{data.message}</p>
          </div>
        )}
        {data.status === 'approved' && (
          <div className={cn('flex items-center gap-[11px] rounded-[14px] bg-acc-dim px-4 py-[14px] text-left', data.message ? 'mt-[14px]' : 'mt-[22px]')}>
            <Icon name="shield" size={18} stroke="#B5A6FF" />
            <span className="text-[13px] leading-[1.4] text-text">{t.landing.successInfo}</span>
          </div>
        )}
      </div>
      <LandingFooter />
    </LandingWrap>
  );
}
