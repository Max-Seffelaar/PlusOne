/**
 * "Has the `po` shell actually mounted?" — the layout suite's readiness gate.
 *
 * `/app` mounts `PlusOneApp` via `next/dynamic` with `ssr: false`
 * (`src/components/po/app-client.tsx`), so until the lazy shell chunk has
 * loaded the page is only the `+1` boot screen. On a cold dev server that chunk
 * compiles on demand, which is slowest for the very first screen of a run.
 *
 * The old gate, Playwright's `waitForSelector('aside, button')`, could not see
 * that: Playwright's CSS engine pierces open shadow roots, and Next's dev-tools
 * indicator is a `<button>` inside one. The gate passed on the indicator, the
 * suite measured the boot screen, and the chrome check failed with "no bottom
 * tab bar" (phone-390 home.door, run 36665534348).
 *
 * This predicate reads the light DOM only (`document.querySelector` never
 * enters a shadow root) and requires the boot screen to be gone. It is passed
 * to `page.waitForFunction`, so it must stay self-contained: no imports, no
 * closures over module values.
 */
export function shellMounted(doc?: Document): boolean {
  const d = doc ?? document;
  if (d.querySelector('[data-po-boot]')) return false;
  return d.querySelector('aside, button') !== null;
}
