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
import { Select, fieldErrorBorder } from './kit';
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

/** A fine pointer from 1024px: the popover variant, where focus stays on the trigger. */
const finePointer = (): void => {
  vi.stubGlobal('matchMedia', vi.fn((q: string) => ({ matches: q === '(min-width: 1024px) and (pointer: fine)' })));
};
afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('opens on click with aria wiring and marks the chosen row with the accent (popover)', () => {
    finePointer();
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

  it('keyboard: ArrowDown opens, arrows/Home/End move, Enter picks (popover: focus on the trigger)', () => {
    finePointer();
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

  it('keyboard: Escape closes without picking and does not bubble (popover: focus on the trigger)', () => {
    finePointer();
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

  it('type-ahead: a prefix jumps, a repeated letter cycles (popover: focus on the trigger)', () => {
    finePointer();
    render(<Harness />);
    key('c');
    expect(combo()).toHaveAttribute('aria-expanded', 'true');
    expect(activeLabel()).toBe('Cologne');
    key('b');
    expect(activeLabel()).toBe('Cologne'); // "cb" matches nothing: stay
  });

  it('type-ahead: repeated first letter cycles through matches (popover: focus on the trigger)', () => {
    finePointer();
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

  it('touch (or no matchMedia): a bottom sheet portalled to <body>, 44px rows, safe-area padding, Cancel', () => {
    const { container } = render(<Harness />);
    fireEvent.click(combo());
    const panel = screen.getByTestId('select-panel');
    // Portalled: a fixed panel inside the screen column would stop at the tab bar.
    expect(container.contains(panel)).toBe(false);
    expect(panel.closest('.fixed')).not.toBeNull();
    expect(panel.className).toContain('max-w-[560px]');
    expect(panel.className).toContain('var(--safe-bottom)');
    for (const opt of screen.getAllByRole('option')) expect(opt.className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: t.shared.kit.selectCancel })).toBeInTheDocument();
  });

  it('fine pointer from 1024px: a portalled popover placed under the field, compact rows only behind the pointer gate, no Cancel', () => {
    finePointer();
    const { container } = render(<Harness />);
    fireEvent.click(combo());
    const panel = screen.getByTestId('select-panel');
    // Portalled + fixed (z8uq9m5m8h): no scrolling ancestor can clip it.
    expect(container.contains(panel)).toBe(false);
    expect(panel.className).toContain('fixed');
    expect(panel).toHaveAttribute('data-placement', 'below');
    expect(panel).not.toHaveAttribute('role', 'dialog');
    for (const opt of screen.getAllByRole('option')) {
      expect(opt.className).toContain('min-h-[44px]');
      expect(opt.className).toContain('lg:[@media(pointer:fine)]:min-h-[36px]');
    }
    expect(screen.queryByRole('button', { name: t.shared.kit.selectCancel })).toBeNull();
    // Picking inside the popover is not an outside tap.
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Berlin' }));
    fireEvent.click(screen.getByRole('option', { name: 'Berlin' }));
    expect(combo()).toHaveTextContent('Berlin');
  });

  it('a tap inside the portalled sheet is not an outside tap', () => {
    render(<Harness />);
    fireEvent.click(combo());
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Cologne' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Cologne' }));
    expect(combo()).toHaveTextContent('Cologne');
  });

  it('kit-input error API: invalid / describedBy / id land on the trigger, error border while closed', () => {
    const { rerender } = render(
      <Select value="" onChange={() => {}} ariaLabel="City" options={OPTIONS} invalid describedBy="city-err" id="city" />,
    );
    const trigger = combo();
    expect(trigger).toHaveAttribute('id', 'city');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger).toHaveAttribute('aria-describedby', 'city-err');
    expect(trigger.className).toContain(fieldErrorBorder);
    fireEvent.click(trigger);
    expect(trigger.className).toContain('border-acc');
    rerender(<Select value="" onChange={() => {}} ariaLabel="City" options={OPTIONS} />);
    expect(combo()).not.toHaveAttribute('aria-invalid');
    expect(combo()).not.toHaveAttribute('aria-describedby');
    expect(combo().className).not.toContain(fieldErrorBorder);
  });
});

describe('Select popover placement (z8uq9m5m8h)', () => {
  const rect = (top: number, height = 50, left = 40, width = 300): DOMRect =>
    ({ top, bottom: top + height, left, right: left + width, width, height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

  function placeTrigger(top: number): { mockRestore: () => void } {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'combobox' ? rect(top) : rect(0, 0, 0, 0);
    });
  }

  it('opens under the trigger, from its viewport rect, with the room below as its cap', () => {
    finePointer();
    vi.stubGlobal('innerHeight', 800);
    vi.stubGlobal('innerWidth', 1280);
    const spy = placeTrigger(100);
    try {
      render(<Harness />);
      fireEvent.click(combo());
      const panel = screen.getByTestId('select-panel');
      expect(panel).toHaveAttribute('data-placement', 'below');
      expect(panel.style.top).toBe('156px'); // 100 + 50 + 6
      expect(panel.style.left).toBe('40px');
      expect(panel.style.width).toBe('300px');
      expect(panel.style.maxHeight).toBe('320px');
      expect(panel.style.bottom).toBe('');
    } finally {
      spy.mockRestore();
    }
  });

  it('flips above when the list does not fit below, anchored by its bottom edge', () => {
    finePointer();
    vi.stubGlobal('innerHeight', 800);
    vi.stubGlobal('innerWidth', 1280);
    const spy = placeTrigger(700);
    try {
      render(<Harness />);
      fireEvent.click(combo());
      const panel = screen.getByTestId('select-panel');
      expect(panel).toHaveAttribute('data-placement', 'above');
      expect(panel.style.bottom).toBe('106px'); // 800 - 700 + 6
      expect(panel.style.top).toBe('');
    } finally {
      spy.mockRestore();
    }
  });

  it('follows the trigger when a scrolling ancestor scrolls or the window resizes', () => {
    finePointer();
    vi.stubGlobal('innerHeight', 800);
    vi.stubGlobal('innerWidth', 1280);
    let top = 100;
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'combobox' ? rect(top) : rect(0, 0, 0, 0);
    });
    try {
      render(
        <div data-testid="scroller" style={{ overflow: 'auto', height: 60 }}>
          <Harness />
        </div>,
      );
      fireEvent.click(combo());
      expect(screen.getByTestId('select-panel').style.top).toBe('156px');
      top = 40;
      fireEvent.scroll(screen.getByTestId('scroller'));
      expect(screen.getByTestId('select-panel').style.top).toBe('96px');
      top = 690;
      fireEvent(window, new Event('resize'));
      expect(screen.getByTestId('select-panel')).toHaveAttribute('data-placement', 'above');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Select touch sheet is a real modal (z8uq9m5m8h)', () => {
  function Page(): JSX.Element {
    return (
      <>
        <button type="button">Behind</button>
        <Harness initial="b" />
      </>
    );
  }

  it('is an aria-modal dialog named like the field, and moves focus into the list', () => {
    render(<Page />);
    fireEvent.click(combo());
    const dialog = screen.getByRole('dialog', { name: 'City' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const list = screen.getByRole('listbox', { name: 'City' });
    expect(dialog.contains(list)).toBe(true);
    expect(list).toHaveFocus();
    expect(list).toHaveAttribute('tabindex', '0');
    // The active option lives on the focused list, not on the (outside) trigger.
    expect(document.getElementById(list.getAttribute('aria-activedescendant')!)).toHaveTextContent('Berlin');
    expect(combo()).not.toHaveAttribute('aria-activedescendant');
  });

  it('makes the rest of the page inert while open and lifts it on close', () => {
    const { container } = render(<Page />);
    const appRoot = container; // the React root, a direct child of <body>
    fireEvent.click(combo());
    const sheetRoot = screen.getByRole('dialog').closest('[data-select-sheet]')!;
    expect(sheetRoot.parentElement).toBe(document.body);
    expect(appRoot).toHaveAttribute('inert');
    expect(sheetRoot).not.toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: t.shared.kit.selectCancel }));
    expect(appRoot).not.toHaveAttribute('inert');
    expect(combo()).toHaveFocus();
  });

  it('traps Tab and Shift+Tab between the list and Cancel', () => {
    render(<Page />);
    fireEvent.click(combo());
    const list = screen.getByRole('listbox');
    const cancel = screen.getByRole('button', { name: t.shared.kit.selectCancel });
    fireEvent.keyDown(list, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(list).toHaveFocus();
    fireEvent.keyDown(list, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('pulls focus back into the sheet when it lands behind the backdrop', () => {
    render(<Page />);
    fireEvent.click(combo());
    screen.getByRole('button', { name: 'Behind', hidden: true }).focus();
    expect(screen.getByRole('listbox')).toHaveFocus();
  });

  it('keys work on the focused list; Escape, a pick, the backdrop and Android back all return focus to the trigger', () => {
    const onChange = vi.fn();
    render(<Harness initial="a" onChange={onChange} />);
    fireEvent.click(combo());
    const list = (): HTMLElement => screen.getByRole('listbox');
    const active = (): string | null => document.getElementById(list().getAttribute('aria-activedescendant')!)!.textContent;
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    expect(active()).toBe('Berlin');
    fireEvent.keyDown(list(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(combo()).toHaveFocus();

    fireEvent.click(combo());
    fireEvent.keyDown(list(), { key: 'End' });
    fireEvent.keyDown(list(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('c');
    expect(combo()).toHaveFocus();

    fireEvent.click(combo());
    const backdrop = screen.getByRole('dialog').previousElementSibling!;
    fireEvent.pointerDown(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(combo()).toHaveFocus();

    fireEvent.click(combo());
    (document.body as HTMLElement).focus();
    act(() => {
      expect(runNativeBackIntercept()).toBe(true);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(combo()).toHaveFocus();
  });

  it('a visible label (labelledBy) names the trigger, the list and the dialog, and titles the sheet', () => {
    render(
      <>
        <span id="city-label">Home city</span>
        <Select value="" onChange={() => {}} labelledBy="city-label" options={OPTIONS} />
      </>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Home city' });
    expect(trigger).not.toHaveAttribute('aria-label');
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Home city' })).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Home city' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Home city');
  });
});
