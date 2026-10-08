'use client';

/**
 * Platform > Overview (z8uq9m2ybj, decision #49) — the platform in numbers for
 * PlusOne's own operators: companies per billing status, MRR/ARR, the trial
 * funnel and 30-day usage.
 *
 * Security shape (CLAUDE.md #1 — RLS/DB is the boundary):
 *  - Gated on `usePoIsPlatformAdmin()` for the UI only, like every Platform
 *    screen: a non-admin who types /app/platform/overview gets the flat "not
 *    available" state and no read is fired. The boundary is the three
 *    SECURITY DEFINER RPCs (20261012130000), which raise 42501 for anyone who
 *    is not is_platform_admin() — before they touch a table.
 *  - Aggregates only, computed in SQL. No company name, no person, no guest.
 *
 * Status buckets: in the browser, Trial and "Trial, payment set up" split the
 * SQL trialing bucket (20261012150000) so every company still sits in exactly
 * one tile. The native shell shows no payment copy (store-tax seam, guarded by
 * PURCHASE_COPY in the flows), so there Trial is the whole trialing bucket.
 *
 * Revenue: MRR = monthly payers × the monthly price + yearly payers × the
 * yearly price / 12, excl. VAT, from OUR subscription records × the live
 * Stripe prices (lookup keys via getBillingPricesAction — never a hard-coded
 * amount). Without prices (stub, no Stripe key) it shows "—". The whole card
 * is hidden in the native shell and the prices are never even requested
 * there (Apple IAP store-tax seam: no price inside the app).
 *
 * Capacitor (#37): client-side React Query reads, no writes, no browser-only
 * API; works from 390px up (2-column tiles, 4 from md:).
 */
import type { JSX } from 'react';
import { t, fmt } from '@/lib/i18n';
import { isNativeShell } from '@/lib/platform';
import {
  usePoBillingPrices,
  usePoIsPlatformAdmin,
  usePoPlatformSubscriptionCounts,
  usePoPlatformTrialFunnel,
  usePoPlatformUsage,
} from '@/features/po/hooks';
import { platformRevenue, type PlatformSubscriptionCounts } from '@/features/po/adapters';
import { formatPriceAmount } from '@/features/billing/plans';
import { useNav } from '../context';
import { Empty, Label, Scroll, StatTile, Top } from '../kit';

const col = 'flex h-full flex-col';
const grid = 'grid grid-cols-2 gap-2 md:grid-cols-4';
const DASH = '—';

export function PlatformOverview(): JSX.Element {
  const nav = useNav();
  const isPlatformAdmin = usePoIsPlatformAdmin();

  if (!isPlatformAdmin) {
    return (
      <div className={col}>
        <Top big title={t.platform.overviewTitle} onBack={nav.canGoBack ? nav.back : undefined} />
        <Scroll bottom={90}>
          <Empty text={t.platform.notAvailable} />
        </Scroll>
      </div>
    );
  }
  return <OverviewConsole />;
}

function Hint({ children }: { children: string }): JSX.Element {
  return <p className="mt-[8px] px-1 text-[11.5px] leading-[1.4] text-faint">{children}</p>;
}

function OverviewConsole(): JSX.Element {
  const nav = useNav();
  const native = isNativeShell();
  const countsQ = usePoPlatformSubscriptionCounts();
  const funnelQ = usePoPlatformTrialFunnel();
  const usageQ = usePoPlatformUsage();

  const counts = countsQ.data ?? null;
  const funnel = funnelQ.data ?? null;
  const usage = usageQ.data ?? null;
  const failed = countsQ.isError || funnelQ.isError || usageQ.isError;
  const n = (v: number | undefined): number | string => (v === undefined ? DASH : v);

  return (
    <div className={col}>
      <Top
        big
        title={t.platform.overviewTitle}
        sub={t.platform.overviewSubtitle}
        onBack={nav.canGoBack ? nav.back : undefined}
      />
      <Scroll bottom={100}>
        {failed && (
          <p className="mb-3 px-1 text-[12.5px] leading-[1.45] text-red-300" role="alert">
            {t.platform.overviewLoadError}
          </p>
        )}

        <Label className="mb-[10px]">{t.platform.overviewStatusTitle}</Label>
        <div className={grid} data-testid="platform-overview-status">
          <StatTile label={t.platform.overviewTotal} value={n(counts?.total)} accent />
          {/* Store-tax seam: no payment copy inside the native shell, so there
              Trial stays one tile with every running trial. */}
          <StatTile label={t.platform.overviewTrialing} value={n(native ? counts?.trialing : counts?.trialingNoPayment)} />
          {!native && (
            <StatTile label={t.platform.overviewTrialingPaymentSetUp} value={n(counts?.trialingPaymentSetUp)} />
          )}
          <StatTile label={t.platform.overviewTrialLapsed} value={n(counts?.trialLapsed)} />
          <StatTile label={t.platform.overviewPaidMonthly} value={n(counts?.paidMonthly)} />
          <StatTile label={t.platform.overviewPaidYearly} value={n(counts?.paidYearly)} />
          <StatTile label={t.platform.overviewPastDue} value={n(counts?.pastDue)} />
          <StatTile label={t.platform.overviewCanceled} value={n(counts?.canceled)} muted />
          <StatTile label={t.platform.overviewComped} value={n(counts?.comped)} />
          {counts && counts.paidUnknown > 0 && (
            <StatTile label={t.platform.overviewPaidUnknown} value={counts.paidUnknown} />
          )}
          {counts && counts.noSubscription > 0 && (
            <StatTile label={t.platform.overviewNoSubscription} value={counts.noSubscription} muted />
          )}
        </div>

        {/* No price in the native shell (store-tax seam): not rendered, not fetched. */}
        {!native && <RevenueCard counts={counts} />}

        <Label className="mb-[10px] mt-[26px]">{t.platform.overviewTrialsTitle}</Label>
        <div className={grid} data-testid="platform-overview-trials">
          <StatTile label={t.platform.overviewEnding7d} value={n(funnel?.ending7d)} accent />
          <StatTile
            label={t.platform.overviewConverted30d}
            value={
              funnel
                ? fmt(t.platform.overviewConvertedValue, {
                    converted: funnel.converted30d,
                    ended: funnel.ended30d,
                  })
                : DASH
            }
          />
          <StatTile
            label={t.platform.overviewConverted90d}
            value={
              funnel
                ? fmt(t.platform.overviewConvertedValue, {
                    converted: funnel.converted90d,
                    ended: funnel.ended90d,
                  })
                : DASH
            }
          />
          <StatTile label={t.platform.overviewCanceled30d} value={n(funnel?.canceled30d)} muted />
        </div>
        <Hint>{t.platform.overviewTrialsHint}</Hint>

        <Label className="mb-[10px] mt-[26px]">{t.platform.overviewUsageTitle}</Label>
        <div className={grid} data-testid="platform-overview-usage">
          <StatTile label={t.platform.overviewActiveCompanies} value={n(usage?.activeCompanies)} accent />
          <StatTile label={t.platform.overviewEvents} value={n(usage?.events)} />
          <StatTile label={t.platform.overviewCheckIns} value={n(usage?.checkIns)} />
          <StatTile label={t.platform.overviewDormant} value={n(usage?.dormantCompanies)} muted />
        </div>
        <Hint>{t.platform.overviewUsageHint}</Hint>
      </Scroll>
    </div>
  );
}

/** Browser only — the caller never mounts this inside the native shell, so
 *  the price request below never leaves the app there. */
function RevenueCard({ counts }: { counts: PlatformSubscriptionCounts | null }): JSX.Element {
  const pricesQ = usePoBillingPrices();
  const revenue = counts && pricesQ.data !== undefined ? platformRevenue(counts, pricesQ.data) : null;
  const money = (minor: number | undefined): string =>
    revenue && minor !== undefined ? formatPriceAmount({ unitAmount: minor, currency: revenue.currency }) : DASH;
  const noPrices = pricesQ.isSuccess && pricesQ.data === null;
  // Active companies without a recorded interval can't be priced: they are
  // not in the amount, and the hint says so instead of hiding them.
  const leftOut = counts?.paidUnknown ?? 0;
  const hint = [
    t.platform.overviewRevenueHint,
    noPrices ? t.platform.overviewRevenueNoPrices : null,
    leftOut === 1
      ? t.platform.overviewRevenueLeftOutOne
      : leftOut > 1
        ? fmt(t.platform.overviewRevenueLeftOut, { count: leftOut })
        : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <Label className="mb-[10px] mt-[26px]">{t.platform.overviewRevenueTitle}</Label>
      <div className="grid grid-cols-2 gap-2" data-testid="platform-overview-revenue">
        <StatTile label={t.platform.overviewMrr} value={money(revenue?.mrr)} accent />
        <StatTile label={t.platform.overviewArr} value={money(revenue?.arr)} />
      </div>
      <Hint>{hint}</Hint>
    </>
  );
}
