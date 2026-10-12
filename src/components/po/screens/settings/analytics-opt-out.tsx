'use client';

// Profile → Privacy → Product analytics (PostHog, decision 1): in-app product
// analytics is on by default and this is the user's own off-switch. Saves on
// every change. Hidden while the value loads or cannot be read (fail quiet: the
// gate already treats an unreadable value as "not tracked").

import type { JSX } from 'react';
import { t } from '@/lib/i18n';
import { usePoAnalyticsOptOut, usePoSetAnalyticsOptOut } from '@/features/po/analytics-opt-out';
import { Label, ToggleRow } from '../../kit';

export function AnalyticsOptOutSection(): JSX.Element | null {
  const p = t.privacy;
  const q = usePoAnalyticsOptOut();
  const save = usePoSetAnalyticsOptOut();
  if (q.data === undefined) return null;
  const sharing = !q.data;

  return (
    <section data-testid="analytics-opt-out">
      <Label className="mb-[10px] mt-[18px]">{p.sectionLabel}</Label>
      <div className="rounded-[18px] border border-line bg-elev px-4 py-1">
        <ToggleRow title={p.optOutTitle} sub={p.optOutSub} on={sharing} set={(on) => save.mutate(!on)} last />
      </div>
      <p className="mt-2 min-h-[18px] text-[12.5px]" aria-live="polite">
        {save.isPending ? (
          <span className="text-faint">{p.saving}</span>
        ) : save.isError ? (
          <span className="text-acc-soft">{p.error}</span>
        ) : save.isSuccess ? (
          <span className="text-acc-soft">{p.saved}</span>
        ) : null}
      </p>
    </section>
  );
}
