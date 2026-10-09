/**
 * The requests empty-state condition on Home (Dashboard B, z8uq9m2vg8): the
 * compact "Create request link" card replaces the chart only while there are 0
 * requests AND no request link the company made itself. With data, the existing
 * block stays.
 */
import { describe, it, expect } from 'vitest';
import { showRequestsEmptyCard, type RequestsEmptyInput } from './home-requests-empty';

const base: RequestsEmptyInput = {
  canCreateLink: true,
  requests: [],
  links: [{ isDefault: true }],
  targetEventId: 'ev-1',
};

describe('showRequestsEmptyCard', () => {
  it('shows the card with 0 requests and only the automatic default link', () => {
    expect(showRequestsEmptyCard(base)).toBe(true);
    expect(showRequestsEmptyCard({ ...base, links: [] })).toBe(true);
  });

  it('keeps the existing block once there is a request', () => {
    expect(showRequestsEmptyCard({ ...base, requests: [{ id: 'r1' }] })).toBe(false);
  });

  it('keeps the existing block once the company made its own link', () => {
    expect(showRequestsEmptyCard({ ...base, links: [{ isDefault: true }, { isDefault: false }] })).toBe(false);
  });

  it('never shows while either read is still loading (no flash of the card)', () => {
    expect(showRequestsEmptyCard({ ...base, requests: undefined })).toBe(false);
    expect(showRequestsEmptyCard({ ...base, links: undefined })).toBe(false);
  });

  it('never shows for a viewer who cannot create a link, or without an event to put it on', () => {
    expect(showRequestsEmptyCard({ ...base, canCreateLink: false })).toBe(false);
    expect(showRequestsEmptyCard({ ...base, targetEventId: null })).toBe(false);
  });
});
