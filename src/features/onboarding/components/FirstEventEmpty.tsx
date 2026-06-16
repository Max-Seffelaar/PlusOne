import Link from 'next/link';
import { Icon } from '@/components/po/icon';

// Post-onboarding "lege staat" (#40d): a venue with no events yet lands here so
// the owner's next step is unmistakable — create the first event, then a guest
// list. A clean, real empty state (not the mock dashboard chrome).
export function FirstEventEmpty({ venueName }: { venueName: string }): JSX.Element {
  return (
    <div className="flex h-full min-h-[480px] flex-col items-center justify-center px-6 py-16 text-center">
      <div className="w-full max-w-[440px]">
        <div className="mx-auto mb-7 flex h-[64px] w-[64px] items-center justify-center rounded-[20px] bg-acc-dim text-acc">
          <Icon name="cal" size={30} />
        </div>
        <h1 className="m-0 font-display text-[30px] font-extrabold tracking-[-0.02em] text-text">
          Maak je eerste event
        </h1>
        <p className="mx-auto mt-3 max-w-[380px] text-[15px] leading-[1.5] text-dim">
          <span className="text-text">{venueName}</span> staat klaar. Maak een event aan en zet je
          eerste gasten op de lijst.
        </p>
        <div className="mt-8 flex flex-col items-center gap-4">
          <Link
            href="/events/new"
            className="inline-flex cursor-pointer items-center gap-2 rounded-[12px] border border-transparent bg-acc px-[20px] py-[13px] font-display text-[15px] font-bold tracking-[-0.01em] text-on-acc transition-[filter,transform] hover:brightness-[1.08] active:scale-[0.985]"
          >
            <Icon name="cal" size={18} sw={2.1} />
            Nieuw event
          </Link>
          <Link
            href="/events"
            className="font-body text-[13.5px] font-semibold text-faint transition-colors hover:text-text"
          >
            Hoe werkt het?
          </Link>
        </div>
      </div>
    </div>
  );
}
