'use client';

import type { JSX } from 'react';
import { cn } from '@/lib/utils';
import { guestSourceParts, type GuestSourceInput } from '@/features/po/format';
import { ActorCaption } from '../../kit';

/**
 * Where a guest came from ("Added by Sanne", "At the door by PlusOne support",
 * "Sign-up link · Joeri") as ONE truncating caption. The actor goes through
 * the kit's ActorCaption: a member's name truncates with the text, PlusOne's
 * own labels are a compact chip that is never clipped (spec #64a, review #466
 * rounds 3–5).
 */
export function GuestSourceCaption({ className, ...props }: GuestSourceInput & { className?: string }): JSX.Element {
  const p = guestSourceParts(props);
  if ('text' in p) return <span className={cn('block min-w-0 truncate', className)}>{p.text}</span>;
  return <ActorCaption template={p.template} slot="name" name={p.name} kind={p.kind} className={className} />;
}
