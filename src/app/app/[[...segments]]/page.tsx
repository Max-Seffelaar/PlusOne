import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Guest list · PlusOne',
};

/**
 * Deliberately empty (86ey9uc87). The shell lives in `../layout.tsx`.
 *
 * This page exists only so the catch-all route MATCHES — every screen has a
 * real, bookmarkable URL (G1) and the layout above renders `PlusOneApp` for
 * all of them. It must stay empty: Next rebuilds the page subtree on every
 * segment-path navigation, so anything rendered from here would remount per
 * navigation, while the layout instance is preserved. Rendering the shell from
 * here is exactly what made `PlusOneApp` remount on every `router.push`.
 *
 * It also still does NO server data work (no `params`, no `searchParams`) —
 * that is what keeps query-string-only navigation (door overlay open/close,
 * event picks) fully client-side, which the door's offline invariant (#25)
 * depends on. See the layout's doc comment.
 *
 * Do not render `PlusOneApp` (or `PlusOneAppClient`) from here again, and never
 * under a page-level `<Suspense>`: `useSearchParams()` suspends during SSR and
 * a server-streamed boundary never hydrates in a tab that has not painted
 * (86eya4yuf). Guarded by `tests/unit/app-shell-no-ssr-suspense.test.ts`.
 */
export default function AppPage(): null {
  return null;
}
