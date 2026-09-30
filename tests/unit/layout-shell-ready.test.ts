// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { AppBootScreen } from '@/components/po/app-client';
import { shellMounted } from '../e2e/layout/shell-ready';

/**
 * QA-1 readiness gate (run 36665534348: phone-390 home.door measured the `+1`
 * boot screen and failed "no bottom tab bar"). The page at that moment was the
 * `ssr:false` boot screen plus Next's dev-tools indicator — a <button> inside an
 * open shadow root, which Playwright's `waitForSelector('aside, button')`
 * pierces. That exact page must NOT count as a mounted shell.
 */

/** The old gate's semantics: CSS that also looks inside open shadow roots. */
function piercingMatch(root: ParentNode, selector: string): boolean {
  if (root.querySelector(selector)) return true;
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.shadowRoot && piercingMatch(el.shadowRoot, selector)) return true;
  }
  return false;
}

function addDevIndicator(): void {
  const portal = document.createElement('nextjs-portal');
  portal.attachShadow({ mode: 'open' }).innerHTML = '<button aria-label="Open Next.js Dev Tools">N</button>';
  document.body.appendChild(portal);
}

describe('layout suite: shellMounted', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('is false on the boot screen, even with the dev indicator button present', () => {
    document.body.innerHTML = renderToStaticMarkup(createElement(AppBootScreen));
    addDevIndicator();
    // The pre-fix gate accepted this page — that is the bug being pinned down.
    expect(piercingMatch(document, 'aside, button')).toBe(true);
    expect(shellMounted(document)).toBe(false);
  });

  it('is false while only the dev indicator exists (boot screen already gone, shell not yet in)', () => {
    addDevIndicator();
    expect(shellMounted(document)).toBe(false);
  });

  it('is true once the shell chrome is in the light DOM', () => {
    addDevIndicator();
    document.body.innerHTML += '<main><nav><div><button>Home</button><button>Events</button></div></nav></main>';
    expect(shellMounted(document)).toBe(true);
  });

  it('the boot screen carries the marker the gate keys on', () => {
    expect(renderToStaticMarkup(createElement(AppBootScreen))).toContain('data-po-boot');
  });

  it('openScreen gates on shellMounted, not on a shadow-piercing selector', () => {
    const probe = readFileSync(join(process.cwd(), 'tests/e2e/layout/probe.ts'), 'utf8');
    expect(probe).toMatch(/waitForFunction\(shellMounted\b/);
    expect(probe).not.toMatch(/waitForSelector\(\s*['"]aside, button['"]/);
  });
});
