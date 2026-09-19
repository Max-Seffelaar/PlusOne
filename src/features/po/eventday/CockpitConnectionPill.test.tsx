// @vitest-environment jsdom
/**
 * The cockpit header's connection pill (z8uq9m0hw4) shows the SyncBar's state
 * in every phase. The phase itself is not an input at all, so an event that has
 * not opened its doors yet still gets a real reading; these cases pin the label
 * and the kit dot's live ping to the connection alone.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { t } from '@/lib/i18n';
import { CockpitConnectionPill } from './CockpitConnectionPill';

describe('CockpitConnectionPill', () => {
  it('reads Live with the pinging dot when realtime is up and the data is fresh', () => {
    const { container } = render(
      <CockpitConnectionPill online realtimeConnected lastSyncAt={Date.now()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(t.cockpit.connLive);
    expect(container.querySelector('.motion-safe\\:animate-ping')).not.toBeNull();
  });

  it('reads Delayed, without the ping, when the realtime channel is down', () => {
    const { container } = render(
      <CockpitConnectionPill online realtimeConnected={false} lastSyncAt={Date.now()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(t.cockpit.connStale);
    expect(container.querySelector('.motion-safe\\:animate-ping')).toBeNull();
  });

  it('reads Offline when the device is offline', () => {
    render(<CockpitConnectionPill online={false} realtimeConnected={false} lastSyncAt={Date.now()} />);
    expect(screen.getByRole('status')).toHaveTextContent(t.cockpit.connOffline);
  });

  it('warns after ten minutes without a sync', () => {
    render(<CockpitConnectionPill online realtimeConnected lastSyncAt={Date.now() - 11 * 60_000} />);
    expect(screen.getByRole('status')).toHaveTextContent(t.cockpit.connWarn);
  });
});
