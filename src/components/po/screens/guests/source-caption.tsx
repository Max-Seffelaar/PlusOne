'use client';

import type { JSX } from 'react';
import { guestSourceParts, type GuestSourceInput } from '@/features/po/format';
import { ActorPhrase } from '../../kit';

/**
 * Where a guest came from ("Added by Sanne", "At the door by PlusOne support",
 * "Sign-up link · Joeri"). The actor goes through the kit's ActorPhrase, so a
 * member's name renders plain and PlusOne's own labels as a typed label
 * (spec #62a, review #466 round 3) — no name can pass for one of them.
 */
export function GuestSourceCaption(props: GuestSourceInput): JSX.Element {
  const p = guestSourceParts(props);
  if ('text' in p) return <>{p.text}</>;
  return <ActorPhrase template={p.template} slot="name" name={p.name} kind={p.kind} />;
}
