'use client';

/**
 * Two-panel onboarding shell (#40): a left marketing panel + a right form column
 * with the Venue · Abonnement · Team step indicator. Responsive — the left panel
 * collapses below lg so the same wizard serves mobile web. Reuses the PLUSONE
 * design kit; no new primitives.
 */
import type { JSX, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { AUTH_GRADIENT } from '@/lib/po/theme';
import { Icon } from '@/components/po/icon';

const STEP_LABELS = ['Venue', 'Plan', 'Team'] as const;

function StepDots({ current }: { current: 1 | 2 | 3 }): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const active = n === current;
        const done = n < current;
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-[26px] w-[26px] items-center justify-center rounded-full font-display text-[12.5px] font-bold',
                active
                  ? 'bg-acc text-on-acc'
                  : done
                    ? 'bg-acc-dim text-acc'
                    : 'border border-line bg-elev2 text-faint'
              )}
            >
              {done ? <Icon name="check" size={13} sw={3} /> : n}
            </span>
            <span
              className={cn(
                'font-display text-[13.5px] font-bold',
                active ? 'text-text' : 'text-faint'
              )}
            >
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && <span className="ml-1 h-px w-7 bg-line" />}
          </div>
        );
      })}
    </div>
  );
}

export function WizardPanel({
  title,
  sub,
  bullets,
}: {
  title: string;
  sub: string;
  bullets?: string[];
}): JSX.Element {
  return (
    <div>
      <h2 className="m-0 font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.02em] text-text">
        {title}
      </h2>
      <p className="mt-4 max-w-[360px] text-[16px] leading-[1.5] text-dim">{sub}</p>
      {bullets && bullets.length > 0 && (
        <ul className="mt-7 flex flex-col gap-[14px]">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-[11px] text-[14.5px] text-text">
              <span className="mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-acc-dim text-acc">
                <Icon name="check" size={13} sw={2.6} />
              </span>
              {b}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WizardShell({
  current,
  panel,
  heading,
  sub,
  children,
  footer,
}: {
  current: 1 | 2 | 3;
  panel: ReactNode;
  heading: string;
  sub?: string;
  children: ReactNode;
  footer: ReactNode;
}): JSX.Element {
  return (
    <div className="flex h-[100dvh] overflow-hidden bg-bg">
      <aside
        className="relative hidden w-[42%] max-w-[540px] shrink-0 flex-col justify-between p-12 lg:flex"
        style={{ background: AUTH_GRADIENT }}
      >
        <div className="flex items-center gap-[11px]">
          <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-acc font-display text-[18px] font-extrabold tracking-[-0.03em] text-on-acc">
            +1
          </div>
          <span className="font-display text-[20px] font-extrabold tracking-[-0.02em] text-text">
            plusone
          </span>
        </div>
        {panel}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-line2 px-6 py-5 sm:px-10">
          <StepDots current={current} />
        </div>
        <div className="po-screen-anim min-h-0 flex-1 overflow-y-auto px-6 py-8 sm:px-10">
          <div className="mx-auto w-full max-w-[460px]">
            <h1 className="m-0 font-display text-[28px] font-extrabold tracking-[-0.02em] text-text">
              {heading}
            </h1>
            {sub && <p className="mb-7 mt-2 text-[15px] leading-[1.5] text-dim">{sub}</p>}
            <div className={cn(sub ? '' : 'mt-7')}>{children}</div>
          </div>
        </div>
        <div className="shrink-0 border-t border-line2 px-6 py-5 sm:px-10">
          <div className="mx-auto w-full max-w-[460px]">{footer}</div>
        </div>
      </main>
    </div>
  );
}
