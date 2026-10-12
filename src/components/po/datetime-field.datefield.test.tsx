// @vitest-environment jsdom
/**
 * DateField calendar navigation (ADE UX round, item C2).
 *
 * Two regressions from the 17/9 screenshot round:
 *  1. typing a date left the calendar on the old month (type "17-10-2026",
 *     calendar still on September — and a click in it silently overrode the
 *     typed date);
 *  2. an empty End date opened on today's month even when the start date sat
 *     months away. `anchor` fixes that.
 *
 * The real react-day-picker is rendered (through next/dynamic), so the caption
 * assertions run against the shipped dropdown caption, not a stub.
 *
 * Isolation (flake fix, 2026-10-12): under full-suite load the first open paid
 * the cold react-day-picker import inside the 5 s test budget and timed out.
 * Vitest then moves on but never cancels the test body, so the abandoned test
 * kept going and — through the global `screen` — typed "17-10-2026" into the
 * NEXT test's field, which then read October instead of September. So: every
 * query is scoped to the test's own render container (an abandoned test can
 * only touch its own, already unmounted tree), the calendar chunk is warmed
 * once up front, and the clock is pinned so "today" and the dropdown range
 * (last year … three years out) never depend on the day the suite runs.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor, within, type BoundFunctions, type queries } from '@testing-library/react';
import { DateField } from './datetime-field';

// Pinned "today": June 2026 — a month none of the assertions expect, so a
// calendar that fell back to today would fail loudly instead of passing by luck.
const TODAY = new Date(2026, 5, 15, 12, 0, 0);

beforeAll(async () => {
  // Only Date is faked: timers stay real so waitFor and the lazy import work.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
  // useIsDesktop: typing is a desktop affordance (touch keeps the input readOnly).
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('min-width: 1024px'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
  // Warm the lazily loaded calendar chunk (next/dynamic) here, under the hook's
  // own generous timeout, instead of inside the first test's 5 s budget.
  await import('./daypicker');
}, 30_000);

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

afterEach(cleanup);

type Scope = BoundFunctions<typeof queries>;

/** Render into this test's own container and return queries scoped to it. */
function renderField(ui: Parameters<typeof render>[0]): Scope {
  const { container } = render(ui);
  return within(container);
}

const dateInput = (q: Scope): HTMLElement => q.getByRole('combobox', { name: /date/i });

/** The month/year the dropdown caption is showing. */
function caption(q: Scope): { month: string; year: string } {
  const selects = q.getAllByRole('combobox').filter((el) => el.tagName === 'SELECT') as HTMLSelectElement[];
  const [monthSel, yearSel] = selects;
  return {
    month: monthSel.options[monthSel.selectedIndex]?.text ?? '',
    year: yearSel.options[yearSel.selectedIndex]?.text ?? '',
  };
}

async function openCalendar(q: Scope): Promise<void> {
  fireEvent.click(dateInput(q));
  await waitFor(() => expect(q.getAllByRole('combobox').some((el) => el.tagName === 'SELECT')).toBe(true));
}

describe('DateField calendar', () => {
  it('opens on the selected value and follows a typed date to its month', async () => {
    const onChange = vi.fn();
    const q = renderField(<DateField value="2026-09-05" onChange={onChange} />);
    await openCalendar(q);
    expect(caption(q)).toEqual({ month: 'September', year: '2026' });

    const input = dateInput(q);
    fireEvent.change(input, { target: { value: '17-10-2026' } });

    await waitFor(() => expect(caption(q)).toEqual({ month: 'October', year: '2026' }));
    // Typing alone does not commit — Enter/blur does (unchanged contract).
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('2026-10-17');
  });

  it('leaves the visible month alone while the typed text cannot be read', async () => {
    const q = renderField(<DateField value="2026-09-05" onChange={vi.fn()} />);
    await openCalendar(q);
    fireEvent.change(dateInput(q), { target: { value: '17-' } });
    expect(caption(q)).toEqual({ month: 'September', year: '2026' });
  });

  it('opens on the anchor month when the field itself is empty', async () => {
    const q = renderField(<DateField value="" anchor="2027-03-14" onChange={vi.fn()} />);
    await openCalendar(q);
    expect(caption(q)).toEqual({ month: 'March', year: '2027' });
  });

  it('prefers its own value over the anchor', async () => {
    const q = renderField(<DateField value="2026-12-31" anchor="2027-03-14" onChange={vi.fn()} />);
    await openCalendar(q);
    expect(caption(q)).toEqual({ month: 'December', year: '2026' });
  });

  it('falls back to today only when there is neither a value nor an anchor', async () => {
    const q = renderField(<DateField value="" onChange={vi.fn()} />);
    await openCalendar(q);
    expect(caption(q)).toEqual({ month: 'June', year: '2026' });
  });
});
