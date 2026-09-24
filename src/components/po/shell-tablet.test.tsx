// @vitest-environment jsdom
/**
 * T1 (z8uq9m0fzj) — tablet layouts, design-system.md "Breakpoints & tablet".
 *
 * The decision has three halves, each pinned here:
 *  1. ONE chrome breakpoint (1024px): below it the bottom-tab chrome, at/above
 *     it the sidebar. No third tablet chrome.
 *  2. The content column is the same in both chromes: `mainMaxClass` caps the
 *     bottom-tab chrome's content too, so a form reads at 640px on an iPad
 *     portrait exactly as on a laptop (a phone never reaches the cap).
 *  3. Input density follows the POINTER, not the width: an iPad in landscape
 *     (≥1024px, touch) keeps the touch date/time inputs.
 *
 * jsdom has no layout engine, so these assert the classes/attributes that
 * produce the layout; the real-browser check is the per-iPad handoff in the PR.
 */
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ResponsiveShell } from './shell-responsive';
import { TabBar } from './shell';
import { DateField, DESKTOP_INPUT_QUERY } from './datetime-field';

/** A matchMedia that evaluates the two features this code asks about. */
function stubDevice({ width, finePointer }: { width: number; finePointer: boolean }): void {
  vi.stubGlobal('matchMedia', (query: string) => {
    const conds: boolean[] = [];
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    if (max) conds.push(width <= Number(max[1]));
    if (min) conds.push(width >= Number(min[1]));
    if (/pointer:\s*fine/.test(query)) conds.push(finePointer);
    return {
      matches: conds.every(Boolean),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderShell(mainMaxClass: string): void {
  render(
    <ResponsiveShell
      serverHint={false}
      isTabRoot
      mobileTab="start"
      setMobileTab={vi.fn()}
      navItems={[]}
      venueName="Club"
      onOpenVenue={vi.fn()}
      onOpenProfile={vi.fn()}
      userName="Max"
      userSub="Admin"
      mainMaxClass={mainMaxClass}
    >
      <div data-testid="screen" />
    </ResponsiveShell>,
  );
}

describe('T1 · one chrome breakpoint, one content column', () => {
  it('iPad portrait (820px) gets the bottom-tab chrome with the content column capped', async () => {
    stubDevice({ width: 820, finePointer: false });
    renderShell('max-w-[640px]');
    // Bottom tabs, no sidebar.
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(screen.getByRole('button', { name: /home/i })).toBeInTheDocument();
    const column = screen.getByTestId('screen').parentElement!;
    expect(column).toHaveClass('mx-auto', 'w-full', 'max-w-[640px]');
  });

  it('iPad landscape (1180px) gets the sidebar chrome with the same column class', async () => {
    stubDevice({ width: 1180, finePointer: false });
    renderShell('max-w-[1080px]');
    await waitFor(() => expect(screen.getByRole('complementary')).toBeInTheDocument());
    expect(screen.getByTestId('screen').parentElement).toHaveClass('max-w-[1080px]');
  });

  it('the tab bar centers its items in a 640px row instead of spreading them', () => {
    render(<TabBar tab="start" setTab={vi.fn()} />);
    const row = screen.getByRole('button', { name: /home/i }).parentElement!;
    expect(row).toHaveClass('mx-auto', 'max-w-[640px]');
  });
});

describe('T1 · input density follows the pointer', () => {
  it('the desktop input query needs BOTH the sidebar width and a fine pointer', () => {
    expect(DESKTOP_INPUT_QUERY).toContain('min-width: 1024px');
    expect(DESKTOP_INPUT_QUERY).toContain('pointer: fine');
  });

  it('iPad landscape (1366px, touch): the date input stays readOnly — tap opens the calendar, no keyboard', () => {
    stubDevice({ width: 1366, finePointer: false });
    render(<DateField value="2026-10-17" onChange={vi.fn()} />);
    // render() runs inside act(), so the matchMedia effect has already run —
    // on a mouse it would have flipped this (the next test proves it does).
    expect(screen.getByRole('combobox')).toHaveAttribute('readonly');
  });

  it('a laptop (1366px, mouse): the date input is typeable', () => {
    stubDevice({ width: 1366, finePointer: true });
    render(<DateField value="2026-10-17" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).not.toHaveAttribute('readonly');
  });
});
