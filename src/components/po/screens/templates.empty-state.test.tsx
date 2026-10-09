// @vitest-environment jsdom
/**
 * Templates list, Back bug (z8uq9m2vg7, Sophie 06-10-2026): the list used to
 * auto-push the editor from an effect whenever it rendered empty, so Back from
 * the editor remounted the list and the effect pushed the editor straight back.
 * The empty state now carries a button; mounting the list never navigates.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { t } from '@/lib/i18n';

const nav = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), setTab: vi.fn(), openDoor: vi.fn(), canGoBack: true };
let templates: unknown[] = [];
let canManage = true;

vi.mock('@/features/po/hooks', () => ({
  usePoTemplates: () => ({ data: templates, isLoading: false, isError: false }),
  usePoCanManageTemplates: () => canManage,
  usePoTemplate: () => ({ data: null }),
  usePoTemplateTiers: () => ({ data: [] }),
}));
vi.mock('@/features/po/mutations', () => ({}));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ venueId: 'v1', venueName: 'Club', roles: ['admin'] }) }));
vi.mock('@/components/po/context', () => ({ useNav: () => nav }));

import { Templates } from './templates';

beforeEach(() => {
  templates = [];
  canManage = true;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('Templates empty state (z8uq9m2vg7)', () => {
  it('never pushes the editor on mount, so Back from the editor stays on the list', () => {
    const { unmount } = render(<Templates />);
    expect(nav.push).not.toHaveBeenCalled();
    // A Back remounts the list: still no push.
    unmount();
    render(<Templates />);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('opens a new template from the empty-state button', () => {
    render(<Templates />);
    fireEvent.click(screen.getByRole('button', { name: t.templates.emptyCta }));
    expect(nav.push).toHaveBeenCalledWith('templateedit', { isNew: true });
  });

  it('shows no button to a role that cannot manage templates', () => {
    canManage = false;
    render(<Templates />);
    expect(screen.queryByRole('button', { name: t.templates.emptyCta })).not.toBeInTheDocument();
    expect(screen.getByText(t.templates.emptyNoRights)).toBeInTheDocument();
  });

  it('lists templates without the empty-state button when there are some', () => {
    templates = [{ id: 'tp1', name: 'Lofi', capacity: null, tierCount: 2 }];
    render(<Templates />);
    expect(screen.getByText('Lofi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.templates.emptyCta })).not.toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });
});
