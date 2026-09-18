// @vitest-environment jsdom
//
// z8uq9m0hw6 — the /r/[token] page. What each state renders, that the venue
// message is text (never markup), that the not-found state stays neutral (#28),
// and the footer link.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RequestStatus } from './request-status';
import type { RequestStatusData } from '@/features/requests/status-view';

afterEach(cleanup);

const base: RequestStatusData = {
  status: 'approved',
  fullName: 'Mila Jansen',
  plusOnes: 4,
  approvedPlusOnes: 2,
  eventName: 'Saturday Sessions',
  date: 'Sat 26 Sept',
  time: '23:00 to 05:00',
  address: 'Warmoesstraat 12, 1012 JD Amsterdam',
  message: 'Happy birthday!\nDoors close at 01:00.',
};

describe('RequestStatus', () => {
  it('reduced approval: approved vs requested, the message, the address and the window', () => {
    render(<RequestStatus data={base} />);
    expect(screen.getByText("You're on the list.")).toBeInTheDocument();
    expect(screen.getByText('· Approved for 3 of 5 people', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/Party of 5/)).not.toBeInTheDocument();
    expect(screen.getByText('Message from the venue')).toBeInTheDocument();
    expect(screen.getByText(/Happy birthday!/)).toBeInTheDocument();
    expect(screen.getByText('Warmoesstraat 12, 1012 JD Amsterdam')).toBeInTheDocument();
    expect(screen.getByText('23:00 to 05:00')).toBeInTheDocument();
  });

  it('renders a message that looks like markup as text, never as an element', () => {
    const { container } = render(
      <RequestStatus data={{ ...base, message: '<img src=x onerror="alert(1)"><b>bold</b>' }} />
    );
    const msg = screen.getByText('<img src=x onerror="alert(1)"><b>bold</b>');
    expect(msg.children).toHaveLength(0); // one text node, no parsed elements
    expect(container.querySelector('img')).toBeNull();
  });

  it('approved as requested keeps the party line and shows no message block', () => {
    render(<RequestStatus data={{ ...base, approvedPlusOnes: null, message: null }} />);
    expect(screen.getByText(/Party of 5/)).toBeInTheDocument();
    expect(screen.queryByText('Message from the venue')).not.toBeInTheDocument();
  });

  it('pending: the window, no address', () => {
    render(<RequestStatus data={{ ...base, status: 'pending', approvedPlusOnes: null, address: null, message: null }} />);
    expect(screen.getByText("You're in the queue.")).toBeInTheDocument();
    expect(screen.getByText('23:00 to 05:00')).toBeInTheDocument();
    expect(screen.queryByText(/Warmoesstraat/)).not.toBeInTheDocument();
  });

  it('not found stays neutral: no event, no time, no address', () => {
    const { container } = render(<RequestStatus data={null} />);
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Saturday|23:00|Warmoes/);
  });

  it('the footer links to plus-one.io in a new tab without leaking the bearer URL', () => {
    render(<RequestStatus data={null} />);
    const link = screen.getByRole('link', { name: /Guest list, handled by PlusOne/ });
    expect(link).toHaveAttribute('href', 'https://plus-one.io');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')?.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
  });
});
