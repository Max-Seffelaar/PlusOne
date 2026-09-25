// @vitest-environment jsdom
/**
 * InfoTip (ADE UX round, item D) — the kit's "i" explainer.
 *
 * Asserts the contract the screens rely on: closed by default, opens on click,
 * closes on Escape / an outside tap / its own close button, and describes the
 * button through `aria-describedby` while open.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { InfoTip } from './kit';

const PROPS = {
  label: 'What the sign-up link does',
  title: 'What the sign-up link does',
  body: 'Every event gets a public page.',
  closeLabel: 'Got it',
};

afterEach(cleanup);

describe('InfoTip', () => {
  it('starts closed and opens on click', () => {
    render(<InfoTip {...PROPS} />);
    const btn = screen.getByRole('button', { name: PROPS.label });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(PROPS.body)).toBeNull();

    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(PROPS.body)).toBeTruthy();
  });

  it('wires aria-describedby to the open panel', () => {
    render(<InfoTip {...PROPS} />);
    const btn = screen.getByRole('button', { name: PROPS.label });
    expect(btn.getAttribute('aria-describedby')).toBeNull();

    fireEvent.click(btn);
    const described = btn.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    const panel = screen.getByRole('dialog');
    expect(panel.id).toBe(described);
    expect(panel.textContent).toContain(PROPS.body);
  });

  it('closes on Escape', () => {
    render(<InfoTip {...PROPS} />);
    const btn = screen.getByRole('button', { name: PROPS.label });
    fireEvent.click(btn);
    expect(screen.getByText(PROPS.body)).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText(PROPS.body)).toBeNull();
    expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on an outside pointerdown but not on one inside the panel', () => {
    render(
      <div>
        <InfoTip {...PROPS} />
        <span data-testid="outside">elsewhere</span>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: PROPS.label }));

    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(screen.getByText(PROPS.body)).toBeTruthy();

    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(screen.queryByText(PROPS.body)).toBeNull();
  });

  it('closes on its own close button', () => {
    render(<InfoTip {...PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: PROPS.label }));
    fireEvent.click(screen.getByRole('button', { name: PROPS.closeLabel }));
    expect(screen.queryByText(PROPS.body)).toBeNull();
  });

  // T1 (design-system.md "Breakpoints & tablet"): an iPad in landscape has
  // desktop width and a finger — it must get the sheet, not a 300px popover
  // with a 36px close button. The popover is gated on a fine pointer.
  it('switches to the anchored popover only for a fine pointer, never on width alone', () => {
    render(<InfoTip {...PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: PROPS.label }));
    const panel = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: PROPS.closeLabel });
    for (const el of [panel, close]) {
      const bareLg = el.className.split(/\s+/).filter((c) => /^lg:(?!\[@media)/.test(c) && !/^lg:pb-/.test(c));
      expect(bareLg, el.tagName).toEqual([]);
    }
    expect(panel.className).toContain('lg:[@media(pointer:fine)]:absolute');
    expect(close.className).toContain('h-[44px]');
  });
});
