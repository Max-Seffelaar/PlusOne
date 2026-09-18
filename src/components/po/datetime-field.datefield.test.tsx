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
 */
import '@testing-library/jest-dom';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { DateField } from './datetime-field';

beforeAll(() => {
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
});

afterEach(cleanup);

/** The month/year the dropdown caption is showing. */
function caption(): { month: string; year: string } {
  const selects = screen.getAllByRole('combobox').filter((el) => el.tagName === 'SELECT') as HTMLSelectElement[];
  const [monthSel, yearSel] = selects;
  return {
    month: monthSel.options[monthSel.selectedIndex]?.text ?? '',
    year: yearSel.options[yearSel.selectedIndex]?.text ?? '',
  };
}

async function openCalendar(): Promise<void> {
  fireEvent.click(screen.getByRole('combobox', { name: /date/i }));
  await waitFor(() => expect(screen.getAllByRole('combobox').some((el) => el.tagName === 'SELECT')).toBe(true));
}

describe('DateField calendar', () => {
  it('opens on the selected value and follows a typed date to its month', async () => {
    const onChange = vi.fn();
    render(<DateField value="2026-09-05" onChange={onChange} />);
    await openCalendar();
    expect(caption()).toEqual({ month: 'September', year: '2026' });

    const input = screen.getByRole('combobox', { name: /date/i });
    fireEvent.change(input, { target: { value: '17-10-2026' } });

    await waitFor(() => expect(caption()).toEqual({ month: 'October', year: '2026' }));
    // Typing alone does not commit — Enter/blur does (unchanged contract).
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('2026-10-17');
  });

  it('leaves the visible month alone while the typed text cannot be read', async () => {
    render(<DateField value="2026-09-05" onChange={vi.fn()} />);
    await openCalendar();
    fireEvent.change(screen.getByRole('combobox', { name: /date/i }), { target: { value: '17-' } });
    expect(caption()).toEqual({ month: 'September', year: '2026' });
  });

  it('opens on the anchor month when the field itself is empty', async () => {
    render(<DateField value="" anchor="2027-03-14" onChange={vi.fn()} />);
    await openCalendar();
    expect(caption()).toEqual({ month: 'March', year: '2027' });
  });

  it('prefers its own value over the anchor', async () => {
    render(<DateField value="2026-12-31" anchor="2027-03-14" onChange={vi.fn()} />);
    await openCalendar();
    expect(caption()).toEqual({ month: 'December', year: '2026' });
  });
});
