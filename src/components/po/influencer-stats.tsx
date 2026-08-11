'use client';

/**
 * Public influencer stats page (Requests-epic F2, 86ey6b3fe — S16, /i/[token]).
 * The influencer's private numbers: totals, per-event mini funnels, copy/QR for
 * upcoming events. Recreated from the approved Claude Design
 * (docs/design/S16-slim.html). PUBLIC surface: like landing.tsx it never imports
 * the po app — only the icon primitive + Tailwind tokens. Entrance animations are
 * translateY-only (#38); clipboard/window access is guarded (#37).
 */
import { type JSX, useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import { Icon } from './icon';

const press = 'transition-[filter,transform,background,border-color,color] hover:brightness-[1.08] active:scale-[0.98]';
const num = (n: number): string => n.toLocaleString('en-US');
const PAGE = 4;

export interface InfluencerStatsFunnel {
  views: number;
  requests: number;
  approved: number;
  checkedIn: number;
}

export interface InfluencerStatsEvent {
  key: string;
  name: string;
  /** e.g. "Sat 12 Jul · Club Vesper" (formatted server-side). */
  dateLabel: string;
  past: boolean;
  /** Landing slug for the copy/QR link; null hides both buttons. */
  slug: string | null;
  f: InfluencerStatsFunnel;
}

export interface InfluencerStatsData {
  name: string;
  venueName: string;
  totals: InfluencerStatsFunnel;
  events: InfluencerStatsEvent[];
}

function eventUrl(slug: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/e/${slug}`;
}

function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (text: string): void => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Clipboard blocked — the URL stays visible elsewhere on the card/modal.
    }
  };
  return [copied, copy];
}

// ── Header ────────────────────────────────────────────────────────────────────
function Header({ name, venue }: { name: string; venue: string }): JSX.Element {
  return (
    <div className="px-0.5 pt-1.5">
      <div className="font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.02em] text-text">
        {fmt(t.influencerStats.greeting, { name })}
      </div>
      <div className="mt-1.5 text-[14.5px] text-dim">{fmt(t.influencerStats.headerSub, { venue })}</div>
    </div>
  );
}

// ── Totals card ───────────────────────────────────────────────────────────────
function Totals({ f, zero }: { f: InfluencerStatsFunnel; zero: boolean }): JSX.Element {
  if (zero) {
    return (
      <div
        className="flex flex-col items-center gap-[14px] rounded-[24px] border border-line px-6 py-[34px] text-center"
        style={{ background: 'linear-gradient(180deg, rgba(181,166,255,0.09), #161618 70%)' }}
      >
        <div className="font-display text-[78px] font-extrabold leading-[0.9] tracking-[-0.03em] text-acc">0</div>
        <div>
          <div className="font-display text-[21px] font-extrabold tracking-[-0.01em] text-text">{t.influencerStats.zeroTitle}</div>
          <div className="mx-auto mt-1.5 max-w-[250px] text-[14px] leading-[1.5] text-dim">{t.influencerStats.zeroBody}</div>
        </div>
      </div>
    );
  }
  const cells: [string, number][] = [
    [t.influencerStats.totalViews, f.views],
    [t.influencerStats.totalRequests, f.requests],
    [t.influencerStats.totalApproved, f.approved],
    [t.influencerStats.totalDoor, f.checkedIn],
  ];
  return (
    <div
      className="rounded-[24px] border border-line px-[22px] py-6"
      style={{ background: 'linear-gradient(180deg, rgba(181,166,255,0.10), #161618 68%)' }}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-[22px]">
        {cells.map(([label, v], i) => {
          const hero = i === 3;
          return (
            <div key={label} className={hero ? 'col-span-2 mt-1.5 border-t border-line2 pt-5' : undefined}>
              <div
                className={cn(
                  'font-display font-extrabold leading-[0.92] tracking-[-0.03em] tabular-nums',
                  hero ? 'text-[76px] text-acc' : 'text-[40px] text-text',
                )}
              >
                {num(v)}
              </div>
              <div className={cn(hero ? 'mt-2 text-[15px] font-semibold text-dim' : 'mt-[5px] text-[13px] font-medium text-faint')}>{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Search ────────────────────────────────────────────────────────────────────
function Search({ q, setQ }: { q: string; setQ: (v: string) => void }): JSX.Element {
  return (
    <div className="flex h-[46px] items-center gap-[10px] rounded-[14px] border border-line bg-elev px-3">
      <Icon name="search" size={17} className="text-faint" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t.influencerStats.searchPlaceholder}
        className="min-w-0 flex-1 border-none bg-transparent font-body text-[14.5px] text-text outline-none placeholder:text-faint"
      />
      {q && (
        <button
          type="button"
          aria-label={t.influencerStats.searchClearAria}
          onClick={() => setQ('')}
          className={cn('flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] bg-elev2 text-faint', press)}
        >
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  );
}

// ── Mini funnel ───────────────────────────────────────────────────────────────
function MiniFunnel({ f, muted }: { f: InfluencerStatsFunnel; muted?: boolean }): JSX.Element {
  const steps: [string, number][] = [
    [t.influencerStats.funnelViews, f.views],
    [t.influencerStats.funnelRequests, f.requests],
    [t.influencerStats.funnelApproved, f.approved],
    [t.influencerStats.funnelIn, f.checkedIn],
  ];
  const max = Math.max(1, f.views);
  return (
    <div className={cn('flex flex-col gap-[9px]', muted && 'opacity-85')}>
      {steps.map(([label, v], i) => {
        const last = i === 3;
        const w = Math.max(2, (v / max) * 100);
        return (
          <div key={label} className="flex items-center gap-[11px]">
            <div className={cn('w-16 shrink-0 font-body text-[12.5px] font-semibold', last ? 'text-text' : 'text-dim')}>{label}</div>
            <div className="h-[22px] flex-1 overflow-hidden rounded-[7px] bg-elev2">
              <div
                className={cn('po-bar-fill h-full rounded-[7px]', last ? 'bg-acc' : 'bg-white/[0.16]')}
                style={{ width: `${w}%` }}
              />
            </div>
            <div className={cn('w-11 shrink-0 text-right font-display text-[15px] font-extrabold tabular-nums', last ? 'text-acc' : 'text-text')}>
              {num(v)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── QR modal ──────────────────────────────────────────────────────────────────
function QrModal({ ev, onClose }: { ev: InfluencerStatsEvent; onClose: () => void }): JSX.Element {
  const url = ev.slug ? eventUrl(ev.slug) : '';
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, copy] = useCopy();

  useEffect(() => {
    let cancelled = false;
    import('qrcode')
      .then((m) => m.toDataURL(url, { width: 900, margin: 2, color: { dark: '#0B0B0D', light: '#FFFFFF' } }))
      .then((d) => {
        if (!cancelled) setDataUrl(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div
      className="po-anim-fade fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(6,6,8,0.68)] p-5 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className="po-anim-sheet flex w-full max-w-[320px] flex-col items-center gap-4 rounded-[22px] border border-line bg-elev p-[22px] shadow-[0_30px_90px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full items-start justify-between gap-[10px]">
          <div>
            <div className="font-display text-[18px] font-extrabold tracking-[-0.01em] text-text">{ev.name}</div>
            <div className="mt-0.5 text-[12.5px] text-faint">{t.influencerStats.qrHint}</div>
          </div>
          <button
            type="button"
            aria-label={t.influencerStats.qrClose}
            onClick={onClose}
            className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-line bg-transparent text-faint', press)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="rounded-[16px] bg-white p-[14px] leading-[0]">
          {failed ? (
            <div className="flex h-[220px] w-[220px] items-center justify-center text-[13px] text-bg">{t.influencerStats.qrUnavailable}</div>
          ) : dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL, next/image adds nothing here
            <img src={dataUrl} alt={fmt(t.influencerStats.qrImageAlt, { url })} className="block h-[220px] w-[220px]" />
          ) : (
            <div className="flex h-[220px] w-[220px] items-center justify-center text-[13px] text-bg">{t.influencerStats.qrGenerating}</div>
          )}
        </div>
        <div className="w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-[12px] border border-line bg-bg px-3 py-[10px] text-center font-body text-[12.5px] text-dim">
          {url}
        </div>
        <div className="flex w-full gap-[10px]">
          <button
            type="button"
            onClick={() => copy(url)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-[7px] rounded-[13px] border py-3 font-display text-[14px] font-bold',
              copied ? 'border-transparent bg-acc-dim text-acc' : 'border-line bg-transparent text-text',
              press,
            )}
          >
            <Icon name={copied ? 'check' : 'copy'} size={15} sw={2.2} />
            {copied ? t.influencerStats.copied : t.influencerStats.copyLink}
          </button>
          {dataUrl ? (
            <a
              href={dataUrl}
              download={`plusone-${ev.slug ?? 'link'}-qr.png`}
              className={cn('inline-flex flex-1 items-center justify-center gap-[7px] rounded-[13px] bg-acc py-3 font-display text-[14px] font-bold text-on-acc', press)}
            >
              <Icon name="dl" size={16} sw={2.2} />
              {t.influencerStats.qrDownload}
            </a>
          ) : (
            <span className="inline-flex flex-1 items-center justify-center gap-[7px] rounded-[13px] bg-acc py-3 font-display text-[14px] font-bold text-on-acc opacity-40">
              <Icon name="dl" size={16} sw={2.2} />
              {t.influencerStats.qrDownload}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Event card ────────────────────────────────────────────────────────────────
function EventCard({ ev, onQr }: { ev: InfluencerStatsEvent; onQr: (ev: InfluencerStatsEvent) => void }): JSX.Element {
  const [copied, copy] = useCopy();
  const started = ev.f.views > 0;
  const canShare = !ev.past && ev.slug != null;
  return (
    <div className={cn('rounded-[20px] border border-line bg-elev p-5 pt-[18px]', ev.past && 'opacity-[0.92]')}>
      <div className="mb-4 flex items-center justify-between gap-[10px]">
        <div>
          <div className="font-display text-[17px] font-extrabold tracking-[-0.01em] text-text">{ev.name}</div>
          <div className="mt-0.5 text-[12.5px] text-faint">{ev.dateLabel}</div>
        </div>
        <span
          className={cn(
            'whitespace-nowrap rounded-[8px] px-[9px] py-[5px] text-[10.5px] font-extrabold uppercase tracking-[0.05em]',
            ev.past ? 'border border-line bg-transparent text-faint' : 'border border-transparent bg-acc-dim text-acc',
          )}
        >
          {ev.past ? t.influencerStats.chipPast : t.influencerStats.chipUpcoming}
        </span>
      </div>
      {started ? (
        <MiniFunnel f={ev.f} muted={ev.past} />
      ) : (
        <div className="flex items-center gap-[9px] rounded-[13px] border border-dashed border-line bg-elev2 p-[14px] text-[13px] text-dim">
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-acc" />
          {t.influencerStats.notLive}
        </div>
      )}
      {canShare && (
        <div className="mt-4 flex gap-[10px]">
          <button
            type="button"
            onClick={() => ev.slug && copy(eventUrl(ev.slug))}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-[7px] rounded-[12px] border py-[11px] font-display text-[13.5px] font-bold',
              copied ? 'border-transparent bg-acc-dim text-acc' : 'border-line bg-elev2 text-text',
              press,
            )}
          >
            <Icon name={copied ? 'check' : 'copy'} size={15} sw={2.2} />
            {copied ? t.influencerStats.copied : t.influencerStats.copyLink}
          </button>
          <button
            type="button"
            onClick={() => onQr(ev)}
            className={cn('inline-flex flex-1 items-center justify-center gap-[7px] rounded-[12px] border border-line bg-elev2 py-[11px] font-display text-[13.5px] font-bold text-text', press)}
          >
            <Icon name="qr" size={15} sw={1.6} stroke="#B5A6FF" />
            {t.influencerStats.qrCode}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Grouped, paginated event list ─────────────────────────────────────────────
function GroupLabel({ children, count }: { children: ReactNode; count?: number }): JSX.Element {
  return (
    <div className="flex items-baseline gap-2 px-0.5 pt-1.5">
      <span className="text-[11.5px] font-bold uppercase tracking-[0.07em] text-faint">{children}</span>
      {count != null && <span className="font-display text-[11.5px] font-bold tabular-nums text-ghost">{count}</span>}
    </div>
  );
}

function EventsGroup({
  label,
  items,
  onQr,
}: {
  label: string;
  items: InfluencerStatsEvent[];
  onQr: (ev: InfluencerStatsEvent) => void;
}): JSX.Element | null {
  const [shown, setShown] = useState(PAGE);
  if (items.length === 0) return null;
  const vis = items.slice(0, shown);
  const rest = items.length - shown;
  return (
    <>
      <GroupLabel count={items.length}>{label}</GroupLabel>
      {vis.map((ev, i) => (
        <div key={ev.key} className="po-screen-anim" style={{ animationDelay: `${0.04 * ((i % PAGE) + 1)}s` }}>
          <EventCard ev={ev} onQr={onQr} />
        </div>
      ))}
      {rest > 0 && (
        <button
          type="button"
          onClick={() => setShown(shown + PAGE)}
          className={cn('rounded-[13px] border border-line bg-transparent py-3 font-display text-[14px] font-bold text-text', press)}
        >
          {fmt(t.influencerStats.showMore, { n: Math.min(PAGE, rest), left: rest })}
        </button>
      )}
    </>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────
function Footer(): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-[14px] pt-2">
      <div className="flex items-center gap-[7px] text-center text-[12.5px] text-faint">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-acc" />
        {t.influencerStats.footerLive}
      </div>
      <div className="inline-flex items-center gap-[9px] rounded-[12px] border border-line bg-elev px-[13px] py-[9px]">
        <span className="flex h-6 w-6 items-center justify-center rounded-[8px] bg-acc font-display text-[12px] font-extrabold tracking-[-0.03em] text-on-acc">
          +1
        </span>
        <span className="text-[12.5px] font-medium text-dim">{t.influencerStats.footerBrand}</span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
/** data=null renders the neutral not-found (invalid / revoked / rate-limited). */
export function InfluencerStats({ data }: { data: InfluencerStatsData | null }): JSX.Element {
  const [qr, setQr] = useState<InfluencerStatsEvent | null>(null);
  const [q, setQ] = useState('');

  if (!data) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-bg px-[18px] py-10 text-text">
        <div className="po-screen-anim w-full max-w-[390px] rounded-[24px] border border-line bg-elev px-[26px] py-[34px] text-center">
          <div className="mx-auto mb-5 flex h-[62px] w-[62px] items-center justify-center rounded-[20px] bg-elev2">
            <Icon name="warn" size={30} className="text-faint" />
          </div>
          <h1 className="m-0 mb-[10px] font-display text-[26px] font-extrabold tracking-[-0.02em]">{t.influencerStats.notFoundTitle}</h1>
          <p className="mx-auto max-w-[300px] text-[15px] leading-[1.55] text-dim">{t.influencerStats.notFoundBody}</p>
        </div>
      </div>
    );
  }

  const zero =
    data.totals.views === 0 && data.totals.requests === 0 && data.totals.approved === 0 && data.totals.checkedIn === 0;
  const norm = q.trim().toLowerCase();
  const match = (e: InfluencerStatsEvent): boolean => !norm || `${e.name} ${e.dateLabel}`.toLowerCase().includes(norm);
  const upcoming = data.events.filter((e) => !e.past).filter(match);
  // The zero state focuses on what's ahead — past events (all zeroes) stay out.
  const past = (zero ? [] : data.events.filter((e) => e.past)).filter(match);
  const none = norm.length > 0 && upcoming.length === 0 && past.length === 0;

  return (
    <div className="relative min-h-[100dvh] bg-bg text-text">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[340px]"
        style={{ background: 'radial-gradient(120% 90% at 50% -18%, #211d3a 0%, rgba(33,29,58,0.35) 42%, rgba(11,11,13,0) 72%)' }}
      />
      <div className="relative mx-auto flex w-full max-w-[430px] flex-col gap-4 px-[18px] py-[26px]">
        <Header name={data.name} venue={data.venueName} />
        <div className="po-screen-anim">
          <Totals f={data.totals} zero={zero} />
        </div>

        <div className="pt-0.5">
          <Search q={q} setQ={setQ} />
        </div>

        {none ? (
          <div className="px-5 py-[30px] text-center text-[14px] text-faint">{fmt(t.influencerStats.noMatch, { q })}</div>
        ) : (
          <>
            <EventsGroup
              key={`up${norm}`}
              label={zero ? t.influencerStats.groupYourEvents : t.influencerStats.groupUpcoming}
              items={upcoming}
              onQr={setQr}
            />
            <EventsGroup key={`past${norm}`} label={t.influencerStats.groupPast} items={past} onQr={setQr} />
          </>
        )}

        <Footer />
      </div>
      {qr && <QrModal ev={qr} onClose={() => setQr(null)} />}
    </div>
  );
}
