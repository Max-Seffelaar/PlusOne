// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { DoorView } from '../model';

// 86ey9e8bd — commit() must never show "on the list" / clear the input for a
// write DoorProvider.addOnSpot actually rejected (its own Zod re-validation
// is the real boundary; the parser's +N/pN grammar has no upper bound of its
// own, so a rejection here is a real, reachable case, not hypothetical).
const addOnSpotMock = vi.fn();
const view: DoorView = {
  event: { name: 'Testavond', venueName: 'De Loods' } as DoorView['event'],
  guests: [],
  refused: [],
  tiers: [{ id: 't1', name: 'Regular', color: '#fff', aliases: [] }] as unknown as DoorView['tiers'],
  insideCount: 0,
  waitingCount: 0,
  insideHeadcount: 0,
  waitingHeadcount: 0,
};

vi.mock('../DoorProvider', () => ({
  useDoor: () => ({
    view,
    defaultTierId: 't1',
    quota: { exempt: true, remaining: null, quota: null },
    addOnSpot: addOnSpotMock,
  }),
}));

// Import AFTER the mock so the component picks up the mocked useDoor.
import { AddOnSpot } from './AddOnSpot';

describe('AddOnSpot commit — never claim success for a rejected write (86ey9e8bd)', () => {
  beforeEach(() => {
    addOnSpotMock.mockReset();
  });

  function typeAndCommit(name: string): void {
    const input = screen.getByPlaceholderText('e.g. "Juri Braakman +2 vip"');
    fireEvent.change(input, { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Add · ${name}`) }));
  }

  it('marks the guest as added and clears the input when addOnSpot succeeds', () => {
    addOnSpotMock.mockReturnValue(true);
    render(<AddOnSpot onBack={vi.fn()} />);
    typeAndCommit('Anna');

    expect(addOnSpotMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Just added · 1')).toBeInTheDocument();
    expect((screen.getByPlaceholderText('e.g. "Juri Braakman +2 vip"') as HTMLInputElement).value).toBe('');
  });

  it('does NOT mark the guest as added or clear the input when addOnSpot rejects the payload', () => {
    addOnSpotMock.mockReturnValue(false);
    render(<AddOnSpot onBack={vi.fn()} />);
    typeAndCommit('Anna');

    expect(addOnSpotMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Just added/)).not.toBeInTheDocument();
    expect((screen.getByPlaceholderText('e.g. "Juri Braakman +2 vip"') as HTMLInputElement).value).toBe('Anna');
  });
});
