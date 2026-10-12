'use client';

/**
 * Cookie banner for the public pages (plan §3, decision 2). Asks once per
 * device and consent version: "Accept all", "Only necessary", or a per-category
 * choice. Until a choice is stored nothing analytics-related loads — no
 * posthog-js, no storage, no request (ePrivacy).
 *
 * Loaded lazily by PublicConsent only when it has to show, so no other page
 * (and never the door) carries this chunk. Never rendered in the native shell
 * (PublicConsent checks) or on a signed-in surface.
 */
import { type JSX, useState } from 'react';
import { t } from '@/lib/i18n';
import { PRIVACY_URL } from '@/lib/legal';
import { Btn, Toggle } from '@/components/po/kit';
import { saveConsent } from './consent';

export default function CookieBanner({ onDone }: { onDone: () => void }): JSX.Element {
  const p = t.privacy;
  const [choosing, setChoosing] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(false);
  const [marketingOn, setMarketingOn] = useState(false);

  const decide = (analytics: boolean, marketing: boolean): void => {
    saveConsent({ analytics, marketing });
    onDone();
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-banner-title"
      data-testid="cookie-banner"
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))] md:px-6 md:pb-6"
    >
      <div className="w-full max-w-[560px] rounded-card border border-line bg-elev p-5 shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
        <h2 id="cookie-banner-title" className="font-display text-[18px] font-bold tracking-[-0.01em] text-text">
          {p.bannerTitle}
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-[1.5] text-dim">{p.bannerBody}</p>
        {/* Same tab, never target=_blank (Capacitor checklist); 44px tall for touch. */}
        <a
          href={PRIVACY_URL}
          className="inline-flex min-h-[44px] items-center text-[13.5px] text-acc-soft underline underline-offset-2"
        >
          {p.bannerPolicy}
        </a>

        {choosing && (
          <div data-testid="cookie-categories" className="mt-3 rounded-[16px] border border-line2 bg-bg/40 px-4">
            <CategoryRow title={p.catNecessaryTitle} sub={p.catNecessarySub} />
            <CategoryRow
              title={p.catAnalyticsTitle}
              sub={p.catAnalyticsSub}
              toggle={<Toggle on={analyticsOn} onClick={() => setAnalyticsOn((v) => !v)} ariaLabel={p.catAnalyticsTitle} />}
            />
            <CategoryRow
              title={p.catMarketingTitle}
              sub={p.catMarketingSub}
              toggle={<Toggle on={marketingOn} onClick={() => setMarketingOn((v) => !v)} ariaLabel={p.catMarketingTitle} />}
              last
            />
          </div>
        )}

        <div className="mt-2 flex flex-col gap-2 md:flex-row-reverse md:flex-wrap">
          {choosing ? (
            <Btn kind="primary" onClick={() => decide(analyticsOn, marketingOn)} className="md:flex-1">
              {p.bannerSave}
            </Btn>
          ) : (
            <Btn kind="primary" onClick={() => decide(true, true)} className="md:flex-1">
              {p.bannerAcceptAll}
            </Btn>
          )}
          <Btn kind="dark" onClick={() => decide(false, false)} className="md:flex-1">
            {p.bannerNecessaryOnly}
          </Btn>
          {!choosing && (
            <Btn kind="ghost" onClick={() => setChoosing(true)} className="md:flex-none">
              {p.bannerChoose}
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryRow({
  title,
  sub,
  toggle,
  last,
}: {
  title: string;
  sub: string;
  toggle?: JSX.Element;
  last?: boolean;
}): JSX.Element {
  return (
    <div className={`flex items-center gap-3 py-3 ${last ? '' : 'border-b border-line2'}`}>
      <div className="flex-1">
        <div className="text-[14px] font-semibold text-text">{title}</div>
        <div className="mt-0.5 text-[12px] leading-[1.4] text-faint">{sub}</div>
      </div>
      {toggle}
    </div>
  );
}
