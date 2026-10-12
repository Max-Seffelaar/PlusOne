// @vitest-environment jsdom
/**
 * The kit Select (z8uq9m4a2w) is a PlusOne listbox, not a native `<select>`:
 * the OS drew the native list (white on Windows, #463). It keeps the old API, so
 * the call sites did not change, and follows the WAI-ARIA select-only combobox:
 * focus stays on the trigger, the active option is `aria-activedescendant`.
 */
import '@testing-library/jest-dom';
import { useState } from 'react';
import type { JSX } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { t } from '@/lib/i18n';
import { Select } from './kit';
import { runNativeBackIntercept } from './native-back-intercept';

afterEach(cleanup);

const OPTIONS = [
  { value: 'a', label: 'Amsterdam' },
  { value: 'b', label: 'Berlin' },
  { value: 'bo', label: 'Bologna' },
  { value: 'c', label: 'Cologne' },
];

function Harness({ initial = '', onChange }: { initial?: string; onChange?: (v: string) => void }): JSX.Element {
  const [v, setV] = useState(initial);
  return (
    <Select
      value={v}
      onChange={(next) => {
        onChange?.(next);
        setV(next);
      }}
      ariaLabel="City"
      placeholder="All cities"
      options={OPTIONS}
    />
  );
}

const combo = (): HTMLElement => screen.getByRole('combobox', { name: 'City' });
const key = (k: string, extra: Record<string, unknown> = {}): void => {
  fireEvent.keyDown(combo(), { key: k, ...extra });
};
const activeLabel = (): string | null => {
  const id = combo().getAttribute('aria-activedescendant');
  return id ? document.getElementById(id)!.textContent : null;
};

describe('Select', () => {
  it('is no native select: a combobox button showing the current label', () => {
    render(<Harness initial="b" />);
    expect(document.querySelector('select')).toBeNull();
    expect(combo().tagName).toBe('BUTTON');
    expect(combo()).toHaveTextContent('Berlin');
    expect(combo()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the placeholder for the "" value and lists it as the first option', () => {
    render(<Harness />);
    expect(combo()).toHaveTextContent('All cities');
    fireEvent.click(combo());
    const opts = screen.getAllByRole('option');
    expect(opts.map((o) => o.textContent)).toEqual(['All cities', 'Amsterdam', 'Berlin', 'Bologna', 'Cologne']);
    expect(opts[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('opens on click with aria wiring and marks the chosen row with the accent', () => {
    render(<Harness initial="c" />);
    fireEvent.click(combo());
    const list = screen.getByRole('listbox', { name: 'City' });
    expect(combo()).toHaveAttribute('aria-expanded', 'true');
    expect(combo()).toHaveAttribute('aria-controls', list.id);
    expect(activeLabel()).toBe('Cologne');
    const chosen = screen.getByRole('option', { name: 'Cologne' });
    expect(chosen).toHaveAttribute('aria-selected', 'true');
    expect(chosen.className).toContain('text-acc');
  });

  it('picks with a click, calls onChange once, closes and keeps focus on the trigger', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(combo());
    fireEvent.click(screen.getByRole('option', { name: 'Berlin' }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(combo()).toHaveTextContent('Berlin');
    expect(combo()).toHaveFocus();
  });

  it('does not call onChange when the current option is picked again', () => {
    const onChange = vi.fn();
    render(<Harness initial="a" onChange={onChange} />);
    fireEvent.click(combo());
    fireEvent.click(screen.getByRole('option', { name: 'Amsterdam' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keyboard: ArrowDown opens, arrows/Home/End move, Enter picks', () => {
    const onChange = vi.fn();
    render(<Harness initial="a" onChange={onChange} />);
    key('ArrowDown');
    expect(activeLabel()).toBe('Amsterdam');
    key('ArrowDown');
    key('ArrowDown');
    expect(activeLabel()).toBe('Bologna');
    key('ArrowUp');
    expect(activeLabel()).toBe('Berlin');
    key('End');
    expect(activeLabel()).toBe('Cologne');
    key('ArrowDown'); // clamps, no wrap
    expect(activeLabel()).toBe('Cologne');
    key('Home');
    expect(activeLabel()).toBe('All cities');
    key('ArrowDown');
    key('ArrowDown');
    key('Enter');
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keyboard: Escape closes without picking and does not bubble', () => {
    const onChange = vi.fn();
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Harness onChange={onChange} />
      </div>,
    );
    key('Enter');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    key('ArrowDown');
    key('Escape');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(outer.mock.calls.map(([e]) => (e as KeyboardEvent).key)).not.toContain('Escape');
    expect(combo()).toHaveFocus();
  });

  it('type-ahead: a prefix jumps, a repeated letter cycles', () => {
    render(<Harness />);
    key('c');
    expect(combo()).toHaveAttribute('aria-expanded', 'true');
    expect(activeLabel()).toBe('Cologne');
    key('b');
    expect(activeLabel()).toBe('Cologne'); // "cb" matches nothing: stay
  });

  it('type-ahead: repeated first letter cycles through matches', () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      key('b');
      expect(activeLabel()).toBe('Berlin');
      key('b');
      expect(activeLabel()).toBe('Bologna');
      key('b');
      expect(activeLabel()).toBe('Berlin');
      vi.advanceTimersByTime(700);
      key('b');
      key('o');
      expect(activeLabel()).toBe('Bologna');
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes on an outside pointerdown, the touch backdrop, Cancel and Android back', () => {
    render(<Harness />);
    fireEvent.click(combo());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(combo());
    fireEvent.click(screen.getByRole('button', { name: t.shared.kit.selectCancel }));
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(combo());
    let handled = false;
    act(() => {
      handled = runNativeBackIntercept();
    });
    expect(handled).toBe(true);
    expect(screen.queryByRole('listbox')).toBeNull();
    // Closed: back is no longer claimed.
    expect(runNativeBackIntercept()).toBe(false);
  });

  it('touch sheet by default, popover only behind a fine pointer from lg (T1)', () => {
    render(<Harness />);
    fireEvent.click(combo());
    const panel = screen.getByTestId('select-panel');
    expect(panel.className).toMatch(/(^| )fixed /);
    expect(panel.className).toContain('max-w-[560px]');
    expect(panel.className).toContain('env(safe-area-inset-bottom)');
    expect(panel.className).toContain('lg:[@media(pointer:fine)]:absolute');
    for (const opt of screen.getAllByRole('option')) {
      expect(opt.className).toContain('min-h-[44px]');
      expect(opt.className).toContain('lg:[@media(pointer:fine)]:min-h-[36px]');
    }
    expect(screen.getByRole('button', { name: t.shared.kit.selectCancel }).className).toContain('lg:[@media(pointer:fine)]:hidden');
  });
});
