import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PlusOneApp } from '@/components/po/app';

export const metadata: Metadata = {
  title: 'Guest list · PlusOne',
};

/**
 * Every screen has a real URL now (G1: `../layout.tsx` + `components/po/routes.ts`).
 * This page intentionally does NO server data work of its own (no `params`, no
 * `searchParams`) — `PlusOneApp` re-derives the active screen from the live URL
 * client-side via `usePathname()`/`useSearchParams()`. Keeping this page free of
 * server-side searchParams reads is what lets Next.js treat query-string-only
 * navigations (door overlay open/close, event picks) as pure client-side
 * updates instead of forcing a network round-trip on every one — see the
 * layout's doc comment for why that matters for the door's offline invariant.
 */
export default function AppPage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <PlusOneApp />
    </Suspense>
  );
}
