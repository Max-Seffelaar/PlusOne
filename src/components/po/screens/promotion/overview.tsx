'use client';

/**
 * Promotion overview (Requests-epic F2, 86ey6b3fe — S15; regrouped under the
 * Promotion hub by G3, 86ey7e03j). Answers "who actually pulls people through
 * the door": the per-event overview funnel, the venue-wide influencer
 * leaderboard (30/90 days/all time) and label-only links. Link MANAGEMENT
 * (cards, QR, pause, edit) lives on the hub's "Per event" tab (event-links.tsx)
 * — this tab links through instead of duplicating it. Entrance animations are
 * translateY-only per #38. RLS self-guards the RPCs (admin/finance/organizer);
 * everyone else reads [].
 */
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import type { PoEvent } from '@/lib/po/types';
import type { PoFunnel, PoLinkFunnelRow } from '@/features/po/queries';
import { usePoEvents, usePoLinkFunnel, usePoPromoLabelFunnel, usePoPromoLeaderboard, usePoVenueLinks, type PromoRange } from '@/features/po/hooks';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Avatar, Empty, pressDesktop } from '../../kit';
import { CreateLinkFlow } from './create-link-flow';
import { EventPicker, Kicker, soonestUpcoming } from './shared';

const press = pressDesktop;
const num = (n: number): string => n.toLocaleString('en-US');

const RANGES: { key: PromoRange; label: string }[] = [
  { key: '30', label: t.promo.range30 },
  { key: '90', label: t.promo.range90 },
  { key: 'all', label: t.promo.rangeAll },
];

// ── Small shared pieces ───────────────────────────────────────────────────────

function Card({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }): JSX.Element {
  return (
    <div className={cn('rounded-[18px] border border-line bg-elev', className)} style={style}>
      {children}
    </div>
  );
}

/** Dashed link-glyph avatar for label-only / standard links. */
function LinkAvatar({ size = 42 }: { size?: number }): JSX.Element {
  return (
    <div
      className="flex shrink-0 items-center justify-center border border-dashed border-line bg-elev2 text-faint"
      style={{ width: size, height: size, borderRadius: size * 0.32 }}
    >
      <Icon name="link" size={size * 0.42} />
    </div>
  );
}

// ── Funnel line (shared everywhere) ───────────────────────────────────────────
function FunnelLine({ f }: { f: PoFunnel }): JSX.Element {
  const parts: [number, string][] = [
    [f.views, t.promo.funnelViews],
    [f.requests, t.promo.funnelRequests],
    [f.approvedHeads, t.promo.funnelApproved],
    [f.checkedInHeads, t.promo.funnelIn],
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5 font-body text-[12.5px] text-faint">
      {parts.map(([v, label], i) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span>
            <b className={cn('font-bold tabular-nums', i === 3 ? 'text-acc' : 'text-dim')}>{num(v)}</b> {label}
          </span>
          {i < 3 && <span className="text-ghost">→</span>}
        </span>
      ))}
    </div>
  );
}

// ── Performance row (leaderboard + no-influencer) ─────────────────────────────
function PerfRow({
  rank,
  name,
  sub,
  f,
  isLabel,
}: {
  rank?: number;
  name: string;
  sub: string;
  f: PoFunnel;
  isLabel?: boolean;
}): JSX.Element {
  return (
    <div className="border-b border-line2 px-[22px] py-[15px] transition-[background] hover:bg-white/[0.02]">
      <div className="flex items-center gap-[14px]">
        {rank != null && (
          <div className="w-5 shrink-0 text-center font-display text-[17px] font-extrabold tabular-nums text-ghost">{rank}</div>
        )}
        {isLabel ? <LinkAvatar size={42} /> : <Avatar name={name} size={42} />}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[16px] font-bold tracking-[-0.01em] text-text">
              {name}
            </span>
          </div>
          <div className="mt-0.5 text-[12.5px] text-faint">{sub}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn('font-display text-[30px] font-extrabold leading-none tracking-[-0.02em] tabular-nums', isLabel ? 'text-text' : 'text-acc')}>
            {num(f.checkedInHeads)}
          </div>
          <div className="mt-[3px] text-[10.5px] tracking-[0.04em] text-faint">{t.promo.checkedInLabel}</div>
        </div>
      </div>
      <div className={cn('mt-[11px]', rank != null ? 'pl-[76px]' : 'pl-[56px]')}>
        <FunnelLine f={f} />
      </div>
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHead({
  kicker,
  title,
  sub,
  right,
}: {
  kicker?: string;
  title: string;
  sub?: string;
  right?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-[14px] flex flex-wrap items-end justify-between gap-4">
      <div>
        {kicker && <Kicker className="mb-[7px]">{kicker}</Kicker>}
        <div className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-text">{title}</div>
        {sub && <div className="mt-[3px] text-[13px] text-faint">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

// ── Pagination (client-side slicing) ──────────────────────────────────────────
function Paginated<T>({
  items,
  pageSize,
  unit,
  render,
}: {
  items: T[];
  pageSize: number;
  unit: string;
  render: (item: T, globalIndex: number) => ReactNode;
}): JSX.Element {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const p = Math.min(page, pages - 1);
  const start = p * pageSize;
  const slice = items.slice(start, start + pageSize);
  const pagerBtn = (disabled: boolean): string =>
    cn(
      'flex h-8 w-8 items-center justify-center rounded-[9px] border border-line bg-elev2 text-text',
      disabled ? 'pointer-events-none opacity-45 text-ghost' : press,
    );
  return (
    <Card className="overflow-hidden">
      {slice.map((it, i) => render(it, start + i))}
      {pages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-line bg-bg px-[22px] py-3">
          <span className="font-body text-[12.5px] text-faint">
            {t.promo.showing}{' '}
            <b className="font-bold tabular-nums text-dim">
              {start + 1}–{Math.min(start + pageSize, items.length)}
            </b>{' '}
            {fmt(t.promo.showingOf, { n: items.length, unit })}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label={t.promo.pagePrevAria} onClick={() => setPage(p - 1)} className={pagerBtn(p === 0)}>
              <Icon name="back" size={16} />
            </button>
            <span className="min-w-[42px] text-center font-display text-[12.5px] font-bold tabular-nums text-dim">
              {p + 1} / {pages}
            </span>
            <button type="button" aria-label={t.promo.pageNextAria} onClick={() => setPage(p + 1)} className={pagerBtn(p === pages - 1)}>
              <Icon name="chev" size={16} />
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Overview card ─────────────────────────────────────────────────────────────
function OverviewCard({
  links,
  events,
  selectedId,
  onPick,
  onManageLinks,
}: {
  links: PoLinkFunnelRow[];
  events: PoEvent[];
  selectedId: string | null;
  onPick: (id: string) => void;
  onManageLinks: () => void;
}): JSX.Element {
  const tot = links.reduce<PoFunnel>(
    (a, l) => ({
      views: a.views + l.views,
      requests: a.requests + l.requests,
      approvedHeads: a.approvedHeads + l.approvedHeads,
      checkedInHeads: a.checkedInHeads + l.checkedInHeads,
    }),
    { views: 0, requests: 0, approvedHeads: 0, checkedInHeads: 0 },
  );
  const tiles: [string, number][] = [
    [t.promo.stepViews, tot.views],
    [t.promo.stepRequests, tot.requests],
    [t.promo.stepApproved, tot.approvedHeads],
    [t.promo.stepCheckedIn, tot.checkedInHeads],
  ];
  const pct = (part: number, whole: number): number => (whole ? Math.round((part / whole) * 100) : 0);
  const conv: [number, string][] = [
    [pct(tot.requests, tot.views), t.promo.convRequested],
    [pct(tot.approvedHeads, tot.requests), t.promo.convApproved],
    [pct(tot.checkedInHeads, tot.approvedHeads), t.promo.convShowedUp],
  ];
  return (
    <Card
      className="p-[22px] sm:px-6"
      style={{ background: 'radial-gradient(140% 200% at 100% 0%, rgba(181,166,255,0.10), #161618 62%)' }}
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-[14px]">
        <div>
          <Kicker className="mb-[7px]">{t.promo.overviewKicker}</Kicker>
          <div className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-text">{t.promo.overviewTitle}</div>
        </div>
        <EventPicker events={events} selectedId={selectedId} onPick={onPick} />
      </div>
      <div className="grid grid-cols-2 gap-[10px] sm:grid-cols-4">
        {tiles.map(([label, v], i) => {
          const last = i === 3;
          return (
            <div key={label} className={cn('rounded-[14px] px-4 py-[14px]', last ? 'border border-transparent bg-acc-dim' : 'border border-line bg-elev2')}>
              <div className={cn('font-display text-[30px] font-extrabold leading-none tracking-[-0.02em] tabular-nums', last ? 'text-acc' : 'text-text')}>
                {num(v)}
              </div>
              <div className={cn('mt-[7px] text-[12.5px]', last ? 'text-dim' : 'text-faint')}>{label}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 font-body text-[12.5px] text-faint">
        {conv.map(([v, label], i) => (
          <span key={label} className="inline-flex items-center gap-2">
            <span>
              <b className="font-bold tabular-nums text-dim">{v}%</b> {label}
            </span>
            {i < 2 && <span className="text-ghost">→</span>}
          </span>
        ))}
        <span className="text-ghost">·</span>
        {/* Link management moved to the Per-event tab (G3) — jump through. */}
        <button type="button" onClick={onManageLinks} className={cn('inline-flex items-center gap-1 font-semibold text-acc', press)}>
          {fmt(t.promo.convLinks, { n: links.length })}
          <Icon name="chev" size={13} />
        </button>
      </div>
    </Card>
  );
}

// ── Range segmented control ───────────────────────────────────────────────────
function RangeSeg({ range, setRange }: { range: PromoRange; setRange: (r: PromoRange) => void }): JSX.Element {
  return (
    <div className="inline-flex gap-[3px] rounded-[11px] border border-line bg-bg p-[3px]">
      {RANGES.map((r) => {
        const on = range === r.key;
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={cn(
              'whitespace-nowrap rounded-[8px] px-[13px] py-2 font-display text-[13px] font-bold',
              on ? 'bg-acc-dim text-acc' : 'text-faint',
              press,
            )}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

// ── States ────────────────────────────────────────────────────────────────────
function EmptyState({ onCreate }: { onCreate?: () => void }): JSX.Element {
  return (
    <Card className="flex flex-col items-center gap-4 px-[26px] py-[44px] text-center">
      <div className="flex h-[60px] w-[60px] items-center justify-center rounded-[18px] border border-dashed border-line bg-elev2 text-acc">
        <Icon name="link" size={26} />
      </div>
      <div>
        <div className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.promo.emptyTitle}</div>
        <div className="mx-auto mt-1.5 max-w-[250px] text-[13.5px] leading-[1.5] text-dim">{t.promo.emptyBody}</div>
      </div>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className={cn('inline-flex items-center gap-2 rounded-[13px] bg-acc px-[18px] py-3 font-display text-[15px] font-bold text-on-acc', press)}
        >
          <Icon name="plus" size={18} sw={2.3} stroke="#16132B" />
          {t.promo.emptyCta}
        </button>
      )}
    </Card>
  );
}

function LoadingState(): JSX.Element {
  const bars = [100, 78, 58, 42];
  return (
    <Card className="overflow-hidden px-[26px] py-[38px]">
      <div className="flex flex-col items-center gap-6">
        <div className="flex w-full max-w-[270px] flex-col gap-3">
          {bars.map((w, i) => {
            const last = i === 3;
            return (
              <div
                key={w}
                className="po-promo-bar relative self-center overflow-hidden rounded-[7px] bg-elev2"
                style={{ width: `${w}%`, height: 20, animationDelay: `${i * 0.12}s` }}
              >
                <div
                  className="po-promo-sweep absolute inset-y-0 left-0 w-[45%] rounded-[7px]"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${last ? '#B5A6FF' : 'rgba(255,255,255,0.24)'}, transparent)`,
                    animationDelay: `${i * 0.12}s`,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="text-center">
          <div className="font-display text-[18px] font-extrabold tracking-[-0.01em] text-text">{t.promo.loadingTitle}</div>
          <div className="mt-1.5 text-[13px] text-faint">
            {t.promo.loadingSub}
            <span className="po-promo-dot">.</span>
            <span className="po-promo-dot" style={{ animationDelay: '0.22s' }}>.</span>
            <span className="po-promo-dot" style={{ animationDelay: '0.44s' }}>.</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Tab body (rendered inside the Promotion hub) ─────────────────────────────
export function PromotionOverview(): JSX.Element {
  const nav = useNav();
  const eventsQ = usePoEvents();
  const venueLinksQ = usePoVenueLinks();
  const [range, setRange] = useState<PromoRange>('30');
  const [pickedEventId, setPickedEventId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const events = eventsQ.data ?? [];
  const linkedIds = new Set((venueLinksQ.data ?? []).map((l) => l.eventId));
  const eventsWithLinks = events.filter((e) => linkedIds.has(e.id));
  // The picker offers events that HAVE links; with none anywhere it falls back to
  // upcoming events, so "Create request link" still has a target.
  const pickerEvents = eventsWithLinks.length > 0 ? eventsWithLinks : events.filter((e) => e.when === 'upcoming');
  const fallback = soonestUpcoming(eventsWithLinks) ?? eventsWithLinks[0] ?? soonestUpcoming(events) ?? events[0] ?? null;
  const selected = events.find((e) => e.id === pickedEventId) ?? fallback;

  const funnelQ = usePoLinkFunnel(selected?.id ?? '');
  const boardQ = usePoPromoLeaderboard(range);
  const labelsQ = usePoPromoLabelFunnel(range);

  const funnel = funnelQ.data ?? [];
  const board = boardQ.data ?? [];
  const labels = labelsQ.data ?? [];

  const firstLoad = eventsQ.isLoading || venueLinksQ.isLoading || (boardQ.isLoading && labelsQ.isLoading && funnelQ.isLoading);
  const anyError = boardQ.isError || labelsQ.isError || funnelQ.isError;
  const noLinksAtAll = !firstLoad && (venueLinksQ.data ?? []).length === 0;

  const openPerEvent = (): void => nav.replace('promotion', { tab: 'events', id: selected?.id });

  let content: ReactNode;
  if (firstLoad) {
    content = <LoadingState />;
  } else if (events.length === 0) {
    content = <Empty text={t.promo.noEvents} />;
  } else if (noLinksAtAll) {
    // No request links anywhere yet — the whole overview collapses to the CTA.
    content = <EmptyState onCreate={selected ? () => setCreating(true) : undefined} />;
  } else if (anyError) {
    content = <Empty text={t.promo.loadError} />;
  } else {
    content = (
      <>
        <OverviewCard
          links={funnel}
          events={pickerEvents}
          selectedId={selected?.id ?? null}
          onPick={setPickedEventId}
          onManageLinks={openPerEvent}
        />

        <div>
          <SectionHead
            kicker={t.promo.deliversKicker}
            title={t.promo.deliversTitle}
            sub={t.promo.deliversSub}
            right={<RangeSeg range={range} setRange={setRange} />}
          />
          {boardQ.isLoading ? (
            <LoadingState />
          ) : board.length === 0 ? (
            <Card className="overflow-hidden">
              <Empty text={t.links.influencersEmpty} />
            </Card>
          ) : (
            <Paginated
              key={range}
              items={board}
              pageSize={6}
              unit={t.promo.unitInfluencers}
              render={(r, gi) => (
                <PerfRow
                  key={r.influencerId}
                  rank={gi + 1}
                  name={r.name}
                  sub={fmt(t.promo.rowSub, { links: r.linksCount, events: r.eventsCount })}
                  f={r}
                />
              )}
            />
          )}
        </div>

        {(labelsQ.isLoading || labels.length > 0) && (
          <div>
            <SectionHead kicker={t.promo.noInfKicker} title={t.promo.noInfTitle} sub={t.promo.noInfSub} />
            {labelsQ.isLoading ? (
              <LoadingState />
            ) : (
              <Paginated
                key={range}
                items={labels}
                pageSize={5}
                unit={t.promo.unitLinks}
                render={(r) => (
                  <PerfRow key={r.linkId} name={r.label ?? t.promo.standardName} sub={r.eventName} f={r} isLabel />
                )}
              />
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-[30px]">
      {content}
      {creating && selected && (
        <CreateLinkFlow eventId={selected.id} eventName={selected.name} events={events} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
