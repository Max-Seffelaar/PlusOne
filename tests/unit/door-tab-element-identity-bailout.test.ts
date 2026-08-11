/**
 * Structural guard for the door subtree's element-identity bailout
 * (86ey9e9vc review, Step 0/1). The fix's own correctness depends on an
 * invariant no type error or lint rule protects: `app.tsx` must hand
 * `<DoorProvider>` a REFERENCE-STABLE child (a memoized element, not inline
 * JSX reconstructed every render), and every layer between that element and
 * `PoDoorTab` must forward `children` unmodified — a `Children.map`,
 * `cloneElement`, or a wrapping boundary anywhere in that chain would produce
 * a new element identity and silently defeat the whole thing.
 *
 * Regression note: a fresh-session /code-review on PR #261 found the PREVIOUS
 * version of this guard (`door-tab-render-scope.test.tsx`) asserted nothing
 * about the real code — it re-implemented the wiring in a local test harness
 * and never imported `app.tsx` at all, so it stayed green even when the real
 * fix was reverted. This file checks the actual source; the runtime half of
 * the invariant (PoDoorTab's own context subscriptions must be narrow enough
 * for the memo to matter) is covered separately in
 * `src/features/door/DoorProvider.test.tsx`.
 *
 * `DoorQueryProvider` wraps `children` in a third-party
 * `PersistQueryClientProvider` (`@tanstack/react-query-persist-client`) this
 * repo doesn't control — its own forwarding behavior is out of scope here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const APP_TSX = path.join(ROOT, 'src', 'components', 'po', 'app.tsx');
const DOOR_PROVIDER = path.join(ROOT, 'src', 'features', 'door', 'DoorProvider.tsx');
const DOOR_QUERY_PROVIDER = path.join(ROOT, 'src', 'features', 'door', 'DoorQueryProvider.tsx');

describe('door subtree element-identity bailout (86ey9e9vc review)', () => {
  it('app.tsx builds the door tab element via useMemo, not inline JSX', () => {
    const src = readFileSync(APP_TSX, 'utf8');
    expect(src).toMatch(/const doorTabElement = useMemo\(/);
  });

  it('app.tsx hands DoorProvider a bare identifier, not a freshly-constructed element', () => {
    const src = readFileSync(APP_TSX, 'utf8');
    // Must be exactly `{doorTabElement}` as DoorProvider's child — a literal
    // `<PoDoorTab .../>` back here would reintroduce a fresh object every
    // PlusOneApp render regardless of the memo existing elsewhere in the file.
    expect(src).toMatch(/<DoorProvider eventId=\{resolvedDoorId\}>\{doorTabElement\}<\/DoorProvider>/);
  });

  it('DoorProvider forwards children unmodified through EVERY context layer (no Children.map/cloneElement, no wrapping boundary at any level)', () => {
    const src = readFileSync(DOOR_PROVIDER, 'utf8');
    expect(src).not.toMatch(/Children\.(map|forEach|toArray)/);
    expect(src).not.toMatch(/cloneElement/);
    // Round-2 review finding: the previous version of this test only checked
    // the INNERMOST Provider's child was `{children}` — DoorSyncContext.Provider
    // or DoorFiltersContext.Provider could each have wrapped it in something
    // else without failing anything. Match the WHOLE nesting chain at once —
    // each opening tag must be followed (mod whitespace) by exactly the next
    // expected opening tag, all the way down to `{children}` and back out —
    // so an extra element inserted ANYWHERE in the chain breaks the match.
    expect(src).toMatch(
      /<DoorContext\.Provider value=\{value\}>\s*<DoorSyncContext\.Provider value=\{sync\}>\s*<DoorFiltersContext\.Provider value=\{filtersValue\}>\s*<DoorToastContext\.Provider value=\{toastValue\}>\{children\}<\/DoorToastContext\.Provider>\s*<\/DoorFiltersContext\.Provider>\s*<\/DoorSyncContext\.Provider>\s*<\/DoorContext\.Provider>/,
    );
  });

  it('DoorQueryProvider forwards children unmodified at the source level (no Children.map/cloneElement)', () => {
    const src = readFileSync(DOOR_QUERY_PROVIDER, 'utf8');
    expect(src).not.toMatch(/Children\.(map|forEach|toArray)/);
    expect(src).not.toMatch(/cloneElement/);
    // Round-2 review finding: a bare `/>\s*\{children\}\s*</ ` anchors to ANY
    // element's closing bracket, not specifically PersistQueryClientProvider's
    // — `<Suspense>{children}</Suspense>` injected right there still has a `>`
    // immediately before `{children}`, so that check couldn't tell "wrapped in
    // Suspense" from "not wrapped at all". `PersistQueryClientProvider`'s own
    // props are multi-line and contain `=>` arrow functions, which rules out a
    // plain `[^>]*` skip (it would stop at the arrow's own `>`) — `(?:[^>]|=>)*`
    // treats a literal `=>` as one unit so it can skip past it, while still
    // stopping at any OTHER bare `>` (an embedded self-closing tag, e.g. a
    // `<Spinner/>` inside an injected wrapper's own props, blocks the skip
    // entirely — regex can't do real nested-tag matching, so a wrapper whose
    // own opening tag has no embedded `>` at all could still slip past this;
    // that residual gap is accepted, not undetected-by-oversight).
    expect(src).toMatch(/<PersistQueryClientProvider(?:[^>]|=>)*>\s*\{children\}\s*<\/PersistQueryClientProvider>/);
  });
});
