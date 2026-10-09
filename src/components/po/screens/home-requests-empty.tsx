'use client';

/**
 * Home's requests empty state (Dashboard B, z8uq9m2vg8). Requests stay on the
 * dashboard as a core feature, but a company that has never had a request and
 * never made a request link sees what the block is for instead of an empty
 * "Requested vs on the list" chart. Once there is data, Home shows the chart
 * exactly as before.
 *
 * "No request link" means no link the company made itself: every event gets a
 * default link from a database trigger (`events_create_default_link`), so
 * counting those would hide this card forever. The data comes from reads Home
 * and the Requests inbox already share (usePoGuestRequests, usePoVenueLinks) —
 * no new query.
 */
import type { JSX, ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { usePoVenueLinks } from '@/features/po/hooks';
import type { PoLinkOption } from '@/features/po/queries';
import { Btn, GuideCard } from '../kit';

export interface RequestsEmptyInput {
  /** The viewer may create a request link (admin, or organizer at this company). */
  canCreateLink: boolean;
  /** Guest requests Home loaded (open, declined and auto-approved), or undefined while loading. */
  requests: readonly unknown[] | undefined;
  /** The company's non-archived request links, or undefined while loading. */
  links: readonly Pick<PoLinkOption, 'isDefault'>[] | undefined;
  /** The event the button opens the request links of (soonest upcoming), if any. */
  targetEventId: string | null;
}

/** Show the compact card instead of the chart. False while either read is loading. */
export function showRequestsEmptyCard({ canCreateLink, requests, links, targetEventId }: RequestsEmptyInput): boolean {
  if (!canCreateLink || !targetEventId) return false;
  if (requests === undefined || links === undefined) return false;
  return requests.length === 0 && links.every((l) => l.isDefault);
}

export function RequestsEmptyCard({ onCreate }: { onCreate: () => void }): JSX.Element {
  return (
    <div data-testid="requests-empty-card">
      <GuideCard
        icon="link"
        className="mb-0"
        title={t.home.requestsEmptyTitle}
        body={t.home.requestsEmptyBody}
        actions={
          <Btn kind="primary" sm icon="link" onClick={onCreate}>
            {t.home.requestsEmptyCta}
          </Btn>
        }
      />
    </div>
  );
}

/**
 * The chart, or the card when there is nothing to chart yet. Mounted only for a
 * viewer who can create a link, so the links read never runs for anyone else.
 */
export function RequestsBlock({
  requests,
  targetEventId,
  onCreate,
  chart,
}: {
  requests: readonly unknown[] | undefined;
  targetEventId: string | null;
  onCreate: (eventId: string) => void;
  chart: ReactNode;
}): JSX.Element | null {
  const links = usePoVenueLinks();
  if (showRequestsEmptyCard({ canCreateLink: true, requests, links: links.data, targetEventId }) && targetEventId) {
    return <RequestsEmptyCard onCreate={() => onCreate(targetEventId)} />;
  }
  return <>{chart}</>;
}
