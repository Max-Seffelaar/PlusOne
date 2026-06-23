'use client';

/** Onboarding intro after a verified magic link (#40). Lightweight hand-off into
 *  the venue-creation flow — not a tutorial (a conscious refinement of #40d). */
import { cn } from '@/lib/utils';
import { AUTH_GRADIENT } from '@/lib/po/theme';
import { Icon } from '@/components/po/icon';
import { Btn } from '@/components/po/kit';

const STEPS = [
  { n: 1, title: 'Set up your venue', sub: 'Name, address, and data retention' },
  { n: 2, title: 'Pick a plan', sub: 'Scales with your venue' },
  { n: 3, title: 'Invite your team', sub: 'Hosts and managers, or do it later' },
] as const;

export function WelkomStep({
  owner,
  onNext,
}: {
  owner: { name: string; email: string };
  onNext: () => void;
}): JSX.Element {
  return (
    <div
      className="flex h-[100dvh] flex-col items-center justify-center overflow-y-auto px-6 py-10"
      style={{ background: AUTH_GRADIENT }}
    >
      <div className="w-full max-w-[460px]">
        <span className="mb-6 inline-flex items-center gap-[7px] rounded-full bg-acc-dim px-3 py-[6px] font-body text-[12.5px] font-bold text-acc">
          <Icon name="check" size={14} sw={2.6} />
          Magic link verified
        </span>
        <h1 className="m-0 font-display text-[40px] font-extrabold leading-[1.02] tracking-[-0.03em] text-text">
          Let&apos;s set up your venue
        </h1>
        <p className="mt-4 text-[16px] leading-[1.5] text-dim">
          Logged in as <span className="text-text">{owner.email || owner.name}</span>. Three quick
          steps and you&apos;re ready to create your first event.
        </p>

        <div className="mt-8 flex flex-col gap-[10px]">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="flex items-center gap-[14px] rounded-[16px] border border-line bg-elev p-[14px]"
            >
              <span
                className={cn(
                  'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full font-display text-[15px] font-bold',
                  s.n === 1 ? 'bg-acc text-on-acc' : 'bg-elev2 text-faint'
                )}
              >
                {s.n}
              </span>
              <div className="min-w-0">
                <div className="font-display text-[15px] font-bold text-text">{s.title}</div>
                <div className="text-[12.5px] text-faint">{s.sub}</div>
              </div>
            </div>
          ))}
        </div>

        <Btn kind="primary" full icon="arrowR" onClick={onNext} className="mt-8">
          Set up account
        </Btn>
      </div>
    </div>
  );
}
