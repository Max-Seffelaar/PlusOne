// @vitest-environment jsdom
/**
 * Event form auto-fill of the End fields (ADE UX round, item C1).
 *
 * Drives the real ScheduleFields through the real DateField, so what is asserted
 * is the behaviour the form ships: the end follows the start at doors + 6 h until
 * the user claims an end field, and clearing the end date hands it back.
 */
import '@testing-library/jest-dom';
import { useState, type JSX } from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { t } from '@/lib/i18n';
import { ScheduleFields, type Schedule } from './schedule-fields';

beforeAll(() => {
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

function Harness({ initial, touched = false }: { initial: Schedule; touched?: boolean }): JSX.Element {
  const [value, setValue] = useState<Schedule>(initial);
  const [endTouched, setEndTouched] = useState(touched);
  return (
    <>
      <ScheduleFields
        writable
        value={value}
        onChange={setValue}
        endTouched={endTouched}
        onEndTouchedChange={setEndTouched}
      />
      <output data-testid="state">{`${value.date}|${value.time}|${value.endDate}|${value.endTime}|${endTouched}`}</output>
    </>
  );
}

const state = (): string => screen.getByTestId('state').textContent ?? '';

/** The two date inputs, in DOM order: start, end. */
const dateInputs = (): HTMLElement[] => screen.getAllByRole('combobox', { name: t.shared.datetime.dateAria });

function typeDate(el: HTMLElement, text: string): void {
  fireEvent.change(el, { target: { value: text } });
  fireEvent.keyDown(el, { key: 'Enter' });
}

describe('ScheduleFields end auto-fill', () => {
  it('derives both end fields from a new start date while the end is untouched', () => {
    render(<Harness initial={{ date: '', time: '23:00', endDate: '', endTime: '' }} />);
    typeDate(dateInputs()[0], '16-10-2026');
    expect(state()).toBe('2026-10-16|23:00|2026-10-17|05:00|false');
  });

  it('stops deriving once an end field is edited, and resumes after Clear', async () => {
    render(<Harness initial={{ date: '2026-10-16', time: '23:00', endDate: '2026-10-17', endTime: '05:00' }} />);

    // A manual end date claims the end fields.
    typeDate(dateInputs()[1], '18-10-2026');
    expect(state()).toBe('2026-10-16|23:00|2026-10-18|05:00|true');

    // A later start change now leaves them alone.
    typeDate(dateInputs()[0], '20-10-2026');
    expect(state()).toBe('2026-10-20|23:00|2026-10-18|05:00|true');

    // "Clear" in the calendar footer empties the end and arms following again.
    fireEvent.click(dateInputs()[1]);
    const clear = await screen.findByRole('button', { name: t.shared.datetime.clear });
    fireEvent.click(clear);
    await waitFor(() => expect(state()).toBe('2026-10-20|23:00|||false'));

    typeDate(dateInputs()[0], '21-10-2026');
    expect(state()).toBe('2026-10-21|23:00|2026-10-22|05:00|false');
  });

  it('never rewrites a stored end when the form starts as touched (edit mode)', () => {
    render(
      <Harness
        touched
        initial={{ date: '2026-10-16', time: '23:00', endDate: '2026-10-17', endTime: '03:00' }}
      />,
    );
    typeDate(dateInputs()[0], '23-10-2026');
    expect(state()).toBe('2026-10-23|23:00|2026-10-17|03:00|true');
  });
});
