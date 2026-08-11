'use client';

/** Small helpers shared across the events screens (hub + edit/tiers/crew/past). */
import type { JSX } from 'react';
import { Empty, Scroll, Top } from '../../kit';

export const col = 'flex h-full flex-col';

/** Full-screen loading / empty / error state with a back header (kit-only). */
export function ScreenState({ onBack, title, text }: { onBack: () => void; title: string; text: string }): JSX.Element {
  return (
    <div className={col}>
      <Top onBack={onBack} title={title} />
      <Scroll bottom={28}>
        <Empty text={text} />
      </Scroll>
    </div>
  );
}
