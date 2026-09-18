// @vitest-environment jsdom
/**
 * Item L (ADE UX round 17/9): the tab, the sidebar entry and the desktop page
 * title read "Check-in", not "Door".
 *
 * The key stays `nav.door` on purpose (it names the tab, not the label), which
 * is exactly why this is worth a test: a future reader who sees `t.nav.door`
 * has no way to tell from the key alone that the visible word changed. What
 * stayed "Door" also matters — the physical door copy ("Doors 23:00", the door
 * price, the `Door host` role, the log's actor fallback) was deliberately left
 * alone.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { t } from '@/lib/i18n';
import { TabBar } from './shell';

describe('item L · Door renamed to Check-in', () => {
  it('the mobile tab bar labels the door tab "Check-in"', () => {
    render(<TabBar tab="deur" setTab={vi.fn()} />);

    expect(screen.getByText('Check-in')).toBeInTheDocument();
    expect(screen.queryByText('Door')).toBeNull();
  });

  it('the nav label and the desktop cockpit title both say "Check-in"', () => {
    // The sidebar (app.tsx) renders `t.nav.door` too, so asserting the value
    // covers both entry points without mounting the whole shell.
    expect(t.nav.door).toBe('Check-in');
    expect(t.cockpit.pageTitle).toBe('Check-in');
  });

  it('the physical-door copy is untouched', () => {
    expect(t.cockpit.doorTime).toBe('doors {time}');
    expect(t.door.logActorFallback).toBe('Door');
  });
});
