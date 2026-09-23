/** The frame every public guest page shares (/e/[slug] landing, closed/full
 *  states, /r/[token] status): the lavender-glow backdrop, the centred column
 *  and the "handled by PlusOne" footer. No hooks and no directive, so it
 *  renders inside the client landing form and the server-rendered status page
 *  alike. Split out of landing.tsx (z8uq9m0hw6) so the status page could grow
 *  without pushing that file past the ~800-line screen budget. */
import type { JSX, ReactNode } from 'react';
import { t } from '@/lib/i18n';

const LANDING_BG = 'radial-gradient(120% 70% at 50% -8%, #211d3a 0%, #100f18 42%, #0B0B0D 100%)';

/** Marketing site the footer credits. */
export const PLUSONE_SITE_URL = 'https://plus-one.io';

/** The footer links to the marketing site in a new tab. `noreferrer` on top of
 *  the asked-for `noopener`: /r/[token] is a bearer URL, and although the site
 *  already sends `strict-origin-when-cross-origin`, the token has no business in
 *  anyone else's Referer header. 44px tall so it is a real tap target. */
export function LandingFooter(): JSX.Element {
  return (
    <div className="mt-[10px] flex justify-center">
      <a
        href={PLUSONE_SITE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-[44px] items-center gap-[7px] rounded-[10px] px-2 text-center text-[12px] text-ghost no-underline transition-colors hover:text-dim focus-visible:text-dim focus-visible:outline focus-visible:outline-1 focus-visible:outline-acc"
      >
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[6px] bg-elev2 font-display text-[9px] font-extrabold tracking-[-0.03em] text-faint">+1</span>
        {t.landing.footer}
      </a>
    </div>
  );
}

export function LandingWrap({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-[18px] pb-10 pt-7 text-text" style={{ background: LANDING_BG }}>
      <div className="po-screen-anim w-full max-w-[460px]">{children}</div>
    </div>
  );
}
