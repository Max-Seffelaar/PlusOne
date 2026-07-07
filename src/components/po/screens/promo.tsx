'use client';

/**
 * Promotion dashboard (Requests-epic F2, 86ey6b3fe — S15). Answers "who actually
 * pulls people through the door": an overview funnel per event, the venue-wide
 * influencer leaderboard (30/90 days/all time), label-only links, the per-event
 * funnel per request link, and the create-request-link flow. Recreated from the
 * approved Claude Design (docs/design/S15-slim.html) on the po kit + tokens;
 * entrance animations are translateY-only per #38. Reached from the More hub,
 * the Statistieken screen, and the desktop sidebar (admin/finance; organizers
 * reach it via RLS too — the RPCs self-guard, everyone else reads []).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import type { PoEvent } from '@/lib/po/types';
import type { PoFunnel, PoLinkFunnelRow } from '@/features/po/queries';
import {
  usePoEvents,
  usePoLinkFunnel,
  usePoPromoLabelFunnel,
  usePoPromoLeaderboard,
  usePoTiers,
  usePoVenueLinks,
  type PromoRange,
} from '@/features/po/hooks';
import { usePoCreateInfluencer, usePoCreateLink } from '@/features/po/mutations';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { useNav } from '../context';
import { Icon } from '../icon';
import { Avatar, Empty, Scroll, Toggle, Top } from '../kit';
import { Sheet } from '../shell';

const col = 'flex h-full flex-col';
const press = 'transition-[filter,transform,background,border-color,color] hover:brightness-[1.09] active:scale-[0.985]';
const num = (n: number): string => n.toLocaleString('en-US');

const RANGES: { key: PromoRange; label: string }[] = [
  { key: '30', label: t.promo.range30 },
  { key: '90', label: t.promo.range90 },
  { key: 'all', label: t.promo.rangeAll },
];

/** "FRENZY · 12 JUL" — the picker/overview event label (PoEvent carries no weekday). */
function eventLabel(e: PoEvent): string {
  return `${e.name} · ${e.date} ${e.mon}`;
}

// ── Small shared pieces ───────────────────────────────────────────────────────

function Kicker({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <div className={cn('font-body text-[11.5px] font-bold uppercase tracking-[0.07em] text-faint', className)}>
      {children}
    </div>
  );
}

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

function PromoChip({ children, accent }: { children: ReactNode; accent?: boolean }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-[7px] px-[7px] py-[3px] font-body text-[10.5px] font-extrabold uppercase tracking-[0.04em]',
        accent ? 'border border-transparent bg-acc-dim text-acc' : 'border border-line text-dim',
      )}
    >
      {children}
    </span>
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

// ── Performance row (leaderboard + no-influencer + per-event) ─────────────────
function PerfRow({
  rank,
  name,
  sub,
  f,
  chips,
  isLabel,
}: {
  rank?: number;
  name: string;
  sub: string;
  f: PoFunnel;
  chips?: ReactNode;
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
            {chips}
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

// ── Event picker ──────────────────────────────────────────────────────────────
function EventPicker({
  events,
  selectedId,
  onPick,
}: {
  events: PoEvent[];
  selectedId: string | null;
  onPick: (id: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const selected = events.find((e) => e.id === selectedId) ?? null;
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t.promo.eventPickerAria}
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-[10px] whitespace-nowrap rounded-[13px] border border-line bg-elev2 px-[15px] py-[11px] font-display text-[14.5px] font-bold text-text',
          press,
        )}
      >
        <Icon name="cal" size={16} stroke="#B5A6FF" />
        {selected ? eventLabel(selected) : '—'}
        <Icon name="chevD" size={16} className="text-ghost" />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-20 min-w-[250px] rounded-[14px] border border-line bg-elev p-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.55)]">
          {events.map((e) => {
            const on = e.id === selectedId;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  onPick(e.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-[9px] rounded-[9px] px-3 py-[11px] text-left font-body text-[13.5px] font-semibold',
                  on ? 'bg-acc-dim text-acc' : 'text-dim',
                  press,
                )}
              >
                <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', on ? 'bg-acc' : 'bg-ghost')} />
                {eventLabel(e)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Overview card ─────────────────────────────────────────────────────────────
function Overview({
  links,
  events,
  selectedId,
  onPick,
}: {
  links: PoLinkFunnelRow[];
  events: PoEvent[];
  selectedId: string | null;
  onPick: (id: string) => void;
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
        <span>{fmt(t.promo.convLinks, { n: links.length })}</span>
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

// ── Create request link modal (form → done) ───────────────────────────────────
function CreateLinkModal({ event, onClose }: { event: PoEvent; onClose: () => void }): JSX.Element {
  const { venueId } = usePoIdentity();
  const tiersQ = usePoTiers(event.id);
  const tiers = useMemo(() => tiersQ.data ?? [], [tiersQ.data]);
  const createInf = usePoCreateInfluencer();
  const createLink = usePoCreateLink(event.id);

  const [step, setStep] = useState<'form' | 'done'>('form');
  const [type, setType] = useState<'influencer' | 'label'>('influencer');
  const [name, setName] = useState('');
  const [tierId, setTierId] = useState('');
  const [auto, setAuto] = useState(true);
  const [capOn, setCapOn] = useState(false);
  const [cap, setCap] = useState(25);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState('');
  const [doneName, setDoneName] = useState('');

  // Default to the event's first tier once loaded (the design preselects one).
  useEffect(() => {
    if (tiers.length > 0) setTierId((cur) => (cur && tiers.some((x) => x.id === cur) ? cur : tiers[0].id));
  }, [tiers]);

  const noTiers = !tiersQ.isLoading && tiers.length === 0;
  const tier = tiers.find((x) => x.id === tierId) ?? null;
  // Auto-approve requires a pinned tier (server-enforced) — disabled without one.
  const autoOn = auto && tier != null;
  const ready = name.trim().length > 0;
  const busy = createInf.isPending || createLink.isPending;

  const inp = 'w-full rounded-[12px] border border-line bg-bg px-[14px] py-3 font-body text-[14.5px] text-text outline-none placeholder:text-faint';
  const stepBtn = cn('flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line bg-elev2 font-display text-[20px] font-bold leading-none text-text', press);
  const closeBtn = (
    <button
      type="button"
      onClick={onClose}
      aria-label={t.promo.closeAria}
      className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-line bg-transparent text-faint', press)}
    >
      <Icon name="close" size={16} />
    </button>
  );

  const create = async (): Promise<void> => {
    if (!ready || busy) return;
    setErr(null);
    const nm = name.trim();
    try {
      let influencerId: string | undefined;
      if (type === 'influencer') {
        if (!venueId) throw new Error(t.promo.errCreate);
        influencerId = await createInf.mutateAsync({ venueId, name: nm });
        if (!influencerId) throw new Error(t.promo.errCreate);
      }
      const created = await createLink.mutateAsync({
        eventId: event.id,
        influencerId,
        label: type === 'label' ? nm : undefined,
        slugBase: nm,
        tierId: tierId || undefined,
        maxHeadcount: capOn ? cap : undefined,
        autoApprove: autoOn,
      });
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setDoneUrl(`${origin}/e/${created.slug ?? ''}`);
      setDoneName(nm);
      setStep('done');
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.promo.errCreate);
    }
  };

  const copy = async (): Promise<void> => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(doneUrl);
        setCopied(true);
      }
    } catch {
      // Clipboard blocked (rare in webviews) — the URL stays visible/selectable.
    }
  };

  return (
    <Sheet onClose={onClose} center={false}>
      {step === 'form' ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.promo.createTitle}</div>
              <div className="mt-[3px] text-[12.5px] text-faint">{t.promo.createSub}</div>
            </div>
            {closeBtn}
          </div>

          <div>
            <Kicker className="mb-2">{t.promo.eventLabel}</Kicker>
            <div className={cn(inp, 'flex items-center justify-between gap-[9px]')}>
              <span className="inline-flex items-center gap-[9px] font-semibold">
                <Icon name="cal" size={16} stroke="#B5A6FF" />
                {eventLabel(event)}
              </span>
              <Icon name="chevD" size={15} className="text-ghost" />
            </div>
          </div>

          <div>
            <Kicker className="mb-2">{t.promo.attachToLabel}</Kicker>
            <div className="flex gap-[3px] rounded-[11px] border border-line bg-bg p-[3px]">
              {(
                [
                  ['influencer', t.promo.attachInfluencer],
                  ['label', t.promo.attachLabel],
                ] as const
              ).map(([k, label]) => {
                const on = type === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setType(k)}
                    className={cn('flex-1 rounded-[8px] py-[9px] font-display text-[13.5px] font-bold', on ? 'bg-acc-dim text-acc' : 'text-faint', press)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'influencer' ? t.promo.influencerNamePlaceholder : t.promo.labelPlaceholder}
              className={cn(inp, 'mt-[10px]')}
            />
          </div>

          <div>
            <Kicker className="mb-2">{t.promo.tierLabel}</Kicker>
            {noTiers ? (
              <>
                <div className="flex gap-[3px] rounded-[11px] border border-dashed border-line bg-bg p-[3px] opacity-60">
                  <span className="flex-1 py-[9px] text-center font-display text-[12.5px] font-bold text-faint">—</span>
                </div>
                <div className="mt-2 text-[12px] leading-[1.4] text-faint">{t.promo.noTiersHint}</div>
              </>
            ) : (
              <>
                <div className="po-scroll flex gap-[3px] overflow-x-auto rounded-[11px] border border-line bg-bg p-[3px]">
                  {tiers.map((x) => {
                    const on = x.id === tierId;
                    return (
                      <button
                        key={x.id}
                        type="button"
                        onClick={() => setTierId(x.id)}
                        className={cn(
                          'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-[8px] px-1 py-[9px] font-display text-[12.5px] font-bold',
                          on ? 'bg-acc-dim text-acc' : 'text-faint',
                          press,
                        )}
                      >
                        {x.short}
                      </button>
                    );
                  })}
                </div>
                {tier && (
                  <div className="mt-2 text-[12px] leading-[1.4] text-faint">
                    {fmt(t.promo.tierExplainer, { tier: tier.short, event: event.name })}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[14px] font-semibold text-text">{t.promo.autoApproveTitle}</div>
              <div className="mt-0.5 text-[12px] leading-[1.4] text-faint">
                {noTiers ? t.promo.autoApproveNeedsTier : t.promo.autoApproveSub}
              </div>
            </div>
            <span className={noTiers ? 'pointer-events-none opacity-40' : undefined}>
              <Toggle on={autoOn} onClick={() => setAuto(!autoOn)} />
            </span>
          </div>

          <div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-text">{t.promo.capacityTitle}</div>
                <div className="mt-0.5 text-[12px] leading-[1.4] text-faint">{t.promo.capacitySub}</div>
              </div>
              <Toggle on={capOn} onClick={() => setCapOn(!capOn)} />
            </div>
            {capOn && (
              <div className="mt-[13px] flex items-center gap-[10px]">
                <button type="button" aria-label={t.promo.capacityLessAria} onClick={() => setCap(Math.max(1, cap - 1))} className={stepBtn}>
                  −
                </button>
                <div className="min-w-[56px] text-center font-display text-[22px] font-extrabold tabular-nums text-text">{cap}</div>
                <button type="button" aria-label={t.promo.capacityMoreAria} onClick={() => setCap(cap + 1)} className={stepBtn}>
                  +
                </button>
                <span className="ml-1 text-[13px] text-faint">{t.promo.capacityUnit}</span>
              </div>
            )}
          </div>

          {err && <div className="text-[13px] font-semibold text-[#E89AC0]">{err}</div>}
          <button
            type="button"
            onClick={() => void create()}
            className={cn(
              'mt-0.5 inline-flex w-full items-center justify-center gap-2 rounded-[13px] bg-acc px-[18px] py-[13px] font-display text-[15px] font-bold text-on-acc',
              press,
              (!ready || busy) && 'pointer-events-none opacity-40',
            )}
          >
            <Icon name="link" size={17} sw={2.2} stroke="#16132B" />
            {busy ? t.promo.creating : t.promo.createCta}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">{closeBtn}</div>
          <div className="-mt-1.5 flex flex-col items-center gap-[10px] text-center">
            <div className="po-promo-floaty flex h-[56px] w-[56px] items-center justify-center rounded-[17px] bg-acc-dim text-acc">
              <Icon name="check" size={27} sw={2.4} />
            </div>
            <div className="font-display text-[20px] font-extrabold tracking-[-0.01em] text-text">{t.promo.doneTitle}</div>
            <div className="max-w-[250px] text-[13px] leading-[1.5] text-dim">
              {fmt(tier ? t.promo.doneBodyTier : t.promo.doneBody, {
                name: doneName || (type === 'influencer' ? t.promo.doneFallbackInfluencer : t.promo.doneFallbackLabel),
                event: event.name,
                tier: tier?.short ?? '',
              })}
              {autoOn ? t.promo.doneAuto : ''}
              {capOn ? fmt(t.promo.doneCap, { cap }) : ''}
            </div>
          </div>
          <div className={cn(inp, 'flex items-center gap-[9px]')}>
            <Icon name="link" size={16} className="text-faint" />
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-body text-[13.5px] text-text">{doneUrl}</span>
            <button
              type="button"
              onClick={() => void copy()}
              className={cn(
                'inline-flex shrink-0 items-center gap-[5px] rounded-[9px] px-[11px] py-[7px] font-display text-[12.5px] font-bold',
                copied ? 'bg-acc-dim text-acc' : 'bg-acc text-on-acc',
                press,
              )}
            >
              <Icon name={copied ? 'check' : 'copy'} size={13} sw={2.3} />
              {copied ? t.promo.copied : t.promo.copy}
            </button>
          </div>
          <div className="flex gap-[10px]">
            <button
              type="button"
              onClick={() => {
                setStep('form');
                setName('');
                setCopied(false);
                setErr(null);
              }}
              className={cn('flex-1 rounded-[13px] border border-line bg-transparent py-3 font-display text-[14.5px] font-bold text-text', press)}
            >
              {t.promo.createAnother}
            </button>
            <button type="button" onClick={onClose} className={cn('flex-1 rounded-[13px] bg-acc py-3 font-display text-[14.5px] font-bold text-on-acc', press)}>
              {t.promo.done}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export function Promo(): JSX.Element {
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
  // usePoEvents is newest-first, so the SOONEST upcoming event is the last one
  // in the upcoming block — that's the default the dashboard opens on.
  const soonest = (list: PoEvent[]): PoEvent | undefined => {
    const upcoming = list.filter((e) => e.when === 'upcoming');
    return upcoming[upcoming.length - 1];
  };
  const fallback = soonest(eventsWithLinks) ?? eventsWithLinks[0] ?? soonest(events) ?? events[0] ?? null;
  const selected = events.find((e) => e.id === pickedEventId) ?? fallback;

  const funnelQ = usePoLinkFunnel(selected?.id ?? '');
  const boardQ = usePoPromoLeaderboard(range);
  const labelsQ = usePoPromoLabelFunnel(range);

  const funnel = funnelQ.data ?? [];
  const board = boardQ.data ?? [];
  const labels = labelsQ.data ?? [];
  const perEvent = [...funnel].sort((a, b) => b.checkedInHeads - a.checkedInHeads);

  const firstLoad = eventsQ.isLoading || venueLinksQ.isLoading || (boardQ.isLoading && labelsQ.isLoading && funnelQ.isLoading);
  const anyError = boardQ.isError || labelsQ.isError || funnelQ.isError;
  const noLinksAtAll = !firstLoad && (venueLinksQ.data ?? []).length === 0;

  const rowName = (r: { influencerName: string | null; label: string | null }): string =>
    r.influencerName ?? r.label ?? t.promo.standardName;

  let content: ReactNode;
  if (firstLoad) {
    content = <LoadingState />;
  } else if (events.length === 0) {
    content = <Empty text={t.promo.noEvents} />;
  } else if (noLinksAtAll) {
    // No request links anywhere yet — the whole dashboard collapses to the CTA.
    content = (
      <div>
        <SectionHead kicker={t.promo.perEventKicker} title={t.promo.perEventTitle} />
        <EmptyState onCreate={selected ? () => setCreating(true) : undefined} />
      </div>
    );
  } else if (anyError) {
    content = <Empty text={t.promo.loadError} />;
  } else {
    content = (
      <>
        <Overview links={funnel} events={pickerEvents} selectedId={selected?.id ?? null} onPick={setPickedEventId} />

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

        <div>
          <SectionHead
            kicker={t.promo.perEventKicker}
            title={t.promo.perEventTitle}
            sub={selected ? fmt(t.promo.perEventSub, { event: eventLabel(selected) }) : undefined}
            right={
              selected ? (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className={cn(
                    'inline-flex items-center gap-[7px] whitespace-nowrap rounded-[11px] border border-line bg-elev2 px-[14px] py-[9px] font-display text-[13.5px] font-bold text-text',
                    press,
                  )}
                >
                  <Icon name="plus" size={15} sw={2.3} stroke="#B5A6FF" />
                  {t.promo.newLink}
                </button>
              ) : undefined
            }
          />
          {funnelQ.isLoading ? (
            <LoadingState />
          ) : perEvent.length === 0 ? (
            <EmptyState onCreate={selected ? () => setCreating(true) : undefined} />
          ) : (
            <Paginated
              key={selected?.id ?? 'none'}
              items={perEvent}
              pageSize={5}
              unit={t.promo.unitLinks}
              render={(l) => (
                <PerfRow
                  key={l.linkId}
                  name={rowName(l)}
                  isLabel={l.influencerId == null}
                  sub={l.influencerId != null ? t.promo.requestLinkSub : t.promo.labelOnlySub}
                  chips={
                    <span className="inline-flex gap-1.5">
                      {l.autoApprove && (
                        <PromoChip>
                          <Icon name="bolt" size={10} sw={2.2} className="text-dim" />
                          {t.promo.chipAuto}
                        </PromoChip>
                      )}
                      {l.maxHeadcount != null && (
                        <PromoChip accent>
                          <Icon name="check" size={10} sw={2.6} stroke="#B5A6FF" />
                          {fmt(t.promo.chipFull, { heads: l.approvedHeads, max: l.maxHeadcount })}
                        </PromoChip>
                      )}
                    </span>
                  }
                  f={l}
                />
              )}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.promo.title} />
      <Scroll bottom={40}>
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-[30px]">{content}</div>
      </Scroll>
      {creating && selected && <CreateLinkModal event={selected} onClose={() => setCreating(false)} />}
    </div>
  );
}
