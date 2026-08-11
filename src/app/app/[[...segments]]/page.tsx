import type { JSX } from 'react';
import type { Metadata } from 'next';
import { PlusOneAppClient } from '@/components/po/app-client';

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
 *
 * The shell mounts through `PlusOneAppClient` (`ssr: false`) — NOT directly
 * under a page-level `<Suspense>`. `useSearchParams()` suspends during SSR, and
 * a server-streamed app boundary never reveals/hydrates in a tab that hasn't
 * painted yet (86eya4yuf — see app-client.tsx). Don't reintroduce a direct
 * `<Suspense><PlusOneApp /></Suspense>` render here.
 */
export default function AppPage(): JSX.Element {
  return <PlusOneAppClient />;
}
