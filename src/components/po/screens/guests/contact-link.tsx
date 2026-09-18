'use client';

// The "this is the same person as a contact you already have" offer (item K).
// Shared by quick-add and the paste-a-list preview so both read identically, and
// kept in its own file so neither screen grows past the 800-LOC line.
//
// Webview-safe: presentation only, no browser API, no effects. Both controls are
// ≥ 44 px tall for the door tablet / phone (Capacitor checklist).

import type { JSX } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { Icon } from '../../icon';
import { press } from './_shared';

/** Exactly one contact carries this name: pre-selected, one tap to undo. */
export function ContactLinkOffer({
  contactName,
  linked,
  onToggle,
  className,
}: {
  contactName: string;
  linked: boolean;
  onToggle: () => void;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-center gap-[8px]', className)}>
      <span
        className={cn(
          'inline-flex min-h-[32px] items-center gap-[6px] rounded-[9px] border px-[11px] py-1.5 font-display text-[13px] font-bold',
          linked ? 'border-acc bg-acc-dim text-text' : 'border-line bg-elev2 text-faint',
        )}
      >
        <Icon name="contact" size={13} className={linked ? 'text-acc' : 'text-ghost'} />
        {linked ? fmt(t.guests.contactLink.match, { name: contactName }) : t.guests.contactLink.off}
      </span>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={linked}
        className={cn(
          'inline-flex min-h-[44px] items-center rounded-[9px] px-[10px] font-body text-[12.5px] font-bold text-acc',
          press,
        )}
      >
        {linked ? t.guests.contactLink.undo : t.guests.contactLink.redo}
      </button>
    </div>
  );
}

/** Two or more contacts carry this name: we cannot know which, so we link none. */
export function ContactLinkAmbiguous({ count, className }: { count: number; className?: string }): JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-center gap-[8px]', className)}>
      <span className="inline-flex min-h-[32px] items-center gap-[6px] rounded-[9px] border border-line bg-elev2 px-[11px] py-1.5 font-display text-[13px] font-bold text-faint">
        <Icon name="contact" size={13} className="text-ghost" />
        {fmt(t.guests.contactLink.ambiguous, { n: count })}
      </span>
      <span className="text-[12px] text-faint">{t.guests.contactLink.ambiguousHint}</span>
    </div>
  );
}
