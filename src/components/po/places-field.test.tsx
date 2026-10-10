// @vitest-environment jsdom
/**
 * PlacesField (z8uq9m2vg5): a plain text field first. Suggestions only after
 * 3 characters and the 250 ms debounce; a pick hands back the suggestion's
 * name plus the details address, with one session token for the whole
 * autocomplete + details round; a server without a key turns the lookups off
 * for the rest of the page.
 */
import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PlacesField, type PlacePick } from './places-field';

let fetchMock: Mock;

function Harness({ onPick }: { onPick: (p: PlacePick) => void }): JSX.Element {
  const [v, setV] = useState('');
  return <PlacesField value={v} onChange={setV} onPick={onPick} ariaLabel="Address" />;
}

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function type(text: string): Promise<void> {
  fireEvent.change(screen.getByRole('combobox', { name: 'Address' }), { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(260);
  });
}

describe('PlacesField', () => {
  it('asks nothing below 3 characters', async () => {
    render(<Harness onPick={() => {}} />);
    await type('Sh');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows suggestions and hands back name + address on a pick, one session token throughout', async () => {
    fetchMock
      .mockReturnValueOnce(
        json({ ok: true, suggestions: [{ placeId: 'ChIJ1', mainText: 'Shelter', secondaryText: 'Amsterdam' }] }),
      )
      .mockReturnValueOnce(
        json({
          ok: true,
          place: { addressLine: 'Overhoeksplein 3', postalCode: '1031 KS', city: 'Amsterdam', country: 'NL', formattedAddress: 'Overhoeksplein 3, Amsterdam' },
        }),
      );
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await type('Shel');
    const option = screen.getByRole('option', { name: /Shelter/ });
    expect(screen.getByText('Suggestions by Google')).toBeInTheDocument();
    await act(async () => {
      fireEvent.mouseDown(option);
      await vi.runAllTimersAsync();
    });
    expect(onPick).toHaveBeenCalledWith({
      name: 'Shelter',
      label: 'Shelter, Amsterdam',
      address: expect.objectContaining({ city: 'Amsterdam', country: 'NL' }),
    });
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies[0]).toMatchObject({ op: 'autocomplete', input: 'Shel' });
    expect(bodies[1]).toMatchObject({ op: 'details', placeId: 'ChIJ1' });
    expect(bodies[0].sessionToken).toBe(bodies[1].sessionToken);
    expect(screen.queryByRole('option')).toBeNull();
  });

  // Last on purpose: "no key" is remembered for the rest of the page (module state).
  it('stays a plain text field when the server has no key, and stops asking', async () => {
    fetchMock.mockReturnValue(json({ enabled: false }));
    render(<Harness onPick={() => {}} />);
    await type('Wibaut');
    await type('Wibautstraat');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Address' })).toHaveValue('Wibautstraat');
  });
});

// Review #437: closing must cancel the pending lookup, or a late answer
// reopens the list under a field that lost focus.
describe('PlacesField — closing cancels the pending lookup', () => {
  it('does not reopen the list after blur within the debounce', async () => {
    vi.resetModules();
    const { PlacesField: Fresh } = await import('./places-field');
    fetchMock.mockReturnValue(
      json({ ok: true, suggestions: [{ placeId: 'ChIJ1', mainText: 'Shelter', secondaryText: 'Amsterdam' }] }),
    );
    function H(): JSX.Element {
      const [v, setV] = useState('');
      return <Fresh value={v} onChange={setV} onPick={() => {}} ariaLabel="Address" />;
    }
    render(<H />);
    const box = screen.getByRole('combobox', { name: 'Address' });
    fireEvent.change(box, { target: { value: 'Shelter' } });
    fireEvent.blur(box);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
