'use client';

/**
 * The Deur tab, as its own subtree (86eykm76k).
 *
 * WHY THIS FILE EXISTS. PR #261 made the door survive an unrelated shell
 * re-render by hand: a memoized `<PoDoorTab>` element in `app.tsx`, held stable
 * by six `useCallback`s and a ten-entry dependency array, so that
 * `DoorProvider`/`DoorQueryProvider` (which forward `children` untouched) could
 * bail React out of re-rendering the check-in list. It worked, and it was
 * fragile in a way nothing could catch: adding a ninth prop to `<PoDoorTab>`
 * without adding it to that dep array froze the new prop silently — no type
 * error, no lint rule, no failing test.
 *
 * The structural fix is to stop bailing out of a re-render that should never
 * have been scheduled. `usePoDoorCandidates` is read HERE, and `usePoEvents` /
 * `usePoGuestRequests` / `usePoCanManageTemplates` are read in sibling
 * components (`AppScreens`, `AppShellChrome`). None of them is an ancestor of
 * the door any more, so an event-list refetch or a request-badge change cannot
 * reach this subtree at all — there is no re-render to bail out of.
 *
 * ONE memo boundary survives, `DoorTree` below, and it is a different kind of
 * thing: `usePoDoorCandidates` declares `notifyOnChangeProps: [… 'isFetching' …]`
 * and the stale-id retry in `MobileDoorBranch` reads `isFetching`, so every
 * candidate refetch re-renders THIS component twice. `React.memo` absorbs that
 * without a dependency list: it compares whatever props `DoorTree` declares, so
 * a ninth prop threaded down to `PoDoorTab` is compared automatically and the
 * type checker refuses to let you forget to thread it. That is the property the
 * old dep array did not have.
 */
import { memo, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { usePoDoorCandidates } from '@/features/po/hooks';
import { autoOpenDoorEvent } from '@/features/po/door-event';
import { DoorProvider } from '@/features/door/DoorProvider';
import { DoorQueryProvider } from '@/features/door/DoorQueryProvider';
import { EventDaySkeleton } from '@/features/po/eventday/EventDaySkeleton';
import { DoorEventPicker, PoDoorTab, type DoorOverlay } from './screens/door';
import { doorPath, type DoorSeg } from './routes';
import type { DoorOverrideState } from './use-door-override';
import { useLatchedDoorVariant } from './use-door-variant';
import { Top } from './kit';
import { t } from '@/lib/i18n';

// Desktop Deur view (T9 fold): the Event-dag cockpit, previously the standalone
// /eventday route, now renders INSIDE the shell as the ≥1024px variant of the
// Door tab. Lazy — mobile/door-only visitors never pull the cockpit chunk; the
// geometry-matched skeleton keeps the frame steady while it fetches.
const EventDayCockpitGate = dynamic(
  () => import('@/features/po/eventday/EventDayCockpit').then((m) => m.EventDayCockpitGate),
  { loading: () => <EventDaySkeleton />, ssr: false },
);

/** Door/Taken tab placeholder while the venue's door event resolves, or when
 *  there is none (no upcoming/live event) so DoorProvider can't be mounted. */
function DoorTabState({ title, text }: { title: string; text: string }): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <Top big title={title} />
      <div className="flex flex-1 items-center justify-center px-8 text-center text-[14px] text-faint">{text}</div>
    </div>
  );
}

/** The door's own sub-navigation, owned by the shell root (it drives raw
 *  History, which is shell-level state) and handed down here as one object. */
export interface DoorNav {
  /** Switch the Check-in/Tasks segment. */
  onTab: (seg: DoorSeg) => void;
  openGuest: (id: string) => void;
  openAdd: () => void;
  closeOverlay: () => void;
  /** Back to the picker (only offered when there is more than one candidate). */
  onChangeEvent: () => void;
  /** Commit an explicit pick from the picker. */
  onPickEvent: (eventId: string) => void;
  /** Write the resolved implicit pick into the URL + door override (#278). */
  pinEvent: (eventId: string | null) => void;
}

/**
 * The mounted door: providers + tab, behind `React.memo`.
 *
 * Every prop it needs is declared here, so `memo`'s shallow compare covers all
 * of them — that is what replaces PR #261's hand-maintained dep array. The
 * callbacks arrive from the shell ROOT (which does not re-render on a candidate
 * refetch), so they are reference-stable across exactly the renders this memo
 * has to absorb, with no `useCallback` needed anywhere.
 */
const DoorTree = memo(function DoorTree({
  eventId,
  seg,
  overlay,
  currentEventName,
  onChangeEvent,
  onTab,
  openGuest,
  openAdd,
  closeOverlay,
}: {
  eventId: string;
  seg: DoorSeg;
  overlay: DoorOverlay;
  /** Set only when there is more than one candidate to switch between. */
  currentEventName?: string;
  onChangeEvent?: () => void;
  onTab: (seg: DoorSeg) => void;
  openGuest: (id: string) => void;
  openAdd: () => void;
  closeOverlay: () => void;
}): JSX.Element {
  return (
    <DoorQueryProvider>
      <DoorProvider eventId={eventId}>
        <PoDoorTab
          tab={seg}
          onTab={onTab}
          overlay={overlay}
          openGuest={openGuest}
          openAdd={openAdd}
          closeOverlay={closeOverlay}
          currentEventName={currentEventName}
          onChangeEvent={onChangeEvent}
        />
      </DoorProvider>
    </DoorQueryProvider>
  );
});

/**
 * Door branch, outbox variant (touch or <1024px): mount the real DoorProvider (offline outbox + realtime)
 * for the venue's current event and render the shared door components. Kept
 * mounted across Deur↔Taken (both are door tabs) so realtime/cache survive the
 * switch; unmounts when leaving for another tab. No event resolvable → empty state.
 *
 * Only ever rendered for the outbox variant and only on a door URL, so the
 * `isMobile` / `isDoorTab` guards that used to wrap the pin effect in `app.tsx`
 * are now structural: the effect cannot run off the door tab because the
 * component carrying it is not mounted there.
 */
function MobileDoorBranch({ doorState, doorNav }: { doorState: DoorOverrideState; doorNav: DoorNav }): JSX.Element {
  const doorCandidatesQuery = usePoDoorCandidates();
  const doorCandidates = doorCandidatesQuery.data;

  // Selection-first (S1.3): an explicit pick (the `?event=` on the door URL, set
  // by "Check-in" from an event card) wins; with exactly one candidate we use it;
  // with several, the user chooses — no auto-pick guess. Only the chosen event's
  // guests are ever loaded, so dozens of live events stay cheap.
  const requestedDoorId = doorState.eventId ?? (doorCandidates.length === 1 ? doorCandidates[0].id : null);
  // Validate the requested id against the real candidate list once it has
  // loaded (G1 review fix — the desktop cockpit already does this via
  // `candidates.find(...)`). Without it, a stale `?event=` — e.g. left over
  // from a venue switch, or reached via the browser's own back/forward —
  // would mount DoorProvider for an event that isn't even this venue's, since
  // an id alone can't be told apart from a foreign one without checking. Skip
  // the check while candidates are still loading so an explicit id from the
  // URL doesn't flash "no event" before the list arrives.
  const resolvedDoorId =
    requestedDoorId && (doorCandidatesQuery.isLoading || doorCandidates.some((e) => e.id === requestedDoorId))
      ? requestedDoorId
      : null;
  const resolvedDoorName = doorCandidates.find((e) => e.id === resolvedDoorId)?.name ?? '';

  // If a requested id isn't in the loaded candidate list, the list itself
  // might just be stale rather than the id being genuinely foreign — e.g.
  // another staff member created/started the event moments ago, or this
  // client's own mutation fired before the invalidation above landed.
  // Refetch once per id before accepting the rejection (G1 review fix; pairs
  // with the doorCandidates invalidation added to the event mutations, which
  // only covers changes made from THIS client).
  const staleDoorRefetchRef = useRef<string | null>(null);
  // The verdict that retry produces, published as state (86eykm7qp round 2): the
  // id whose absence survived its own refetch, so the candidate list has now
  // REJECTED it against a freshly fetched list rather than merely a stale
  // snapshot. The pin effect below releases on this and nothing else.
  //
  // State, not a ref, and deliberately so. The release must never be decided on
  // the same commit that issues the refetch — effects in one component run in
  // declaration order, so a ref written here would already be readable by the
  // pin effect below, which would then drop a pin whose event the retry is
  // about to bring back (an explicit "Check-in" pick for an event a colleague
  // created seconds ago is exactly that case). A state update forces a later
  // render, so "issued" and "confirmed" cannot collapse into one commit.
  //
  // Derived from the candidate list, never from a memory of who chose the id,
  // so it is re-established on any fresh mount and survives a reload.
  const [rejectedDoorId, setRejectedDoorId] = useState<string | null>(null);
  useEffect(() => {
    if (!requestedDoorId || doorCandidatesQuery.isLoading || doorCandidatesQuery.isFetching) return;
    if (doorCandidates.some((e) => e.id === requestedDoorId)) {
      // Present after all (or back again) — clear any standing rejection, and
      // release the spent retry with it (86ey9uc87), so an id that went
      // absent → present → absent again still gets its own refetch instead of
      // being rejected on a possibly-stale list.
      staleDoorRefetchRef.current = null;
      setRejectedDoorId((prev) => (prev === null ? prev : null));
      return;
    }
    if (staleDoorRefetchRef.current === requestedDoorId) {
      // Retry already spent for this id and `isFetching` is false again, so this
      // is the settled list: the rejection is now confirmed.
      setRejectedDoorId((prev) => (prev === requestedDoorId ? prev : requestedDoorId));
      return;
    }
    staleDoorRefetchRef.current = requestedDoorId;
    void doorCandidatesQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- doorCandidatesQuery itself (incl. .refetch) is intentionally omitted: it's a new object each render, and including it would refire this every render instead of only when the inputs actually change
  }, [requestedDoorId, doorCandidatesQuery.isLoading, doorCandidatesQuery.isFetching, doorCandidates]);

  // Pin the implicit single-candidate door choice (86eykm7qp). `requestedDoorId`
  // above only DERIVES it from `doorCandidates.length === 1` and never writes it
  // back, so it was recomputed every render: the moment a second event went live
  // mid-shift — React Query's `refetchOnReconnect` default refires the candidate
  // query after any wifi hiccup, and `PoLiveProvider` doesn't disable it — the id
  // flipped to null, `<DoorEventPicker>` took `<DoorQueryProvider>`'s place in the
  // same slot, and React unmounted the entire door tree, tearing down
  // `useDoorSync`'s realtime channel in the middle of a check-in. `pinEvent`
  // lands the choice in `doorOverride` AND the raw URL with no router round-trip,
  // so the door's offline invariant (#25) is untouched.
  //
  // Both halves are derived from CURRENT state, never from a memory of what this
  // mount has written before (round-2 review of #278):
  //  - The write guard asks "is the state already what I would write?", not "have
  //    I ever written this?". `doorState.eventId` returns to null WITHOUT a
  //    remount — `useDoorOverride`'s popstate listener drops the override on any
  //    back/forward (86ey9tq62), and a door entered from the bottom tab has no
  //    `?event=` in Next's tracked search string to fall back to. A sticky ref
  //    refused the re-pin there, so one hardware-back out of a guest overlay —
  //    the door's most common gesture — restored the original bug. Comparing
  //    against `doorState.eventId` is self-healing: after the write the state IS
  //    the value, so the effect stops on its own.
  //  - The release fires on `rejectedDoorId`, the candidate list's own settled
  //    verdict, so it needs no memory of who chose the id. That is what makes it
  //    work on a FRESH mount: the pin survives a reload (it is in the URL) but a
  //    ref does not, so a tablet reloading last night's pinned URL used to land
  //    on "geen event" with no picker (only >1 candidates renders one) and no way
  //    out.
  const { pinEvent } = doorNav;
  useEffect(() => {
    if (doorState.eventId !== null) {
      // Re-check the list here too: `rejectedDoorId` is state, so on the commit
      // where the effect above clears it this still reads the previous value.
      if (rejectedDoorId === doorState.eventId && !doorCandidates.some((e) => e.id === doorState.eventId)) {
        pinEvent(null);
      }
      return;
    }
    if (resolvedDoorId === null) return;
    pinEvent(resolvedDoorId);
  }, [doorState.eventId, resolvedDoorId, rejectedDoorId, doorCandidates, pinEvent]);

  const doorTitle = doorState.seg === 'taken' ? t.door.tasksTitle : t.door.checkinTitle;
  const hasMultipleDoorCandidates = doorCandidates.length > 1;

  if (resolvedDoorId) {
    return (
      <DoorTree
        eventId={resolvedDoorId}
        seg={doorState.seg}
        overlay={doorState.overlay}
        currentEventName={hasMultipleDoorCandidates ? resolvedDoorName : undefined}
        onChangeEvent={hasMultipleDoorCandidates ? doorNav.onChangeEvent : undefined}
        onTab={doorNav.onTab}
        openGuest={doorNav.openGuest}
        openAdd={doorNav.openAdd}
        closeOverlay={doorNav.closeOverlay}
      />
    );
  }
  if (doorCandidatesQuery.isLoading) return <DoorTabState title={doorTitle} text={t.common.loading} />;
  if (hasMultipleDoorCandidates) {
    // Several live/open events and nothing picked yet → choose first (S1.3). The
    // /app shell keeps the bottom-tab menu visible around this picker.
    return <DoorEventPicker events={doorCandidates} onPick={doorNav.onPickEvent} />;
  }
  return <DoorTabState title={doorTitle} text={t.door.noEvent} />;
}

/**
 * Door branch, desktop (fine pointer at ≥1024px): the Event-dag cockpit (T9 fold — this was the
 * standalone /eventday route until it lost the app menu; now it lives inside the
 * shell). Online-only by design (no outbox): reads via React Query + realtime,
 * check-in through the door gateway — exactly as /eventday worked. The event
 * choice rides on the `?event=` query param, so "Check-in" from an event card
 * lands here and a viewport resize keeps the same event.
 *
 * Reads the URL's event id, never the door override: the cockpit must never
 * carry one (it has no outbox and no raw-history sub-nav).
 */
function DesktopCockpitBranch({
  chosenId,
  onChoose,
}: {
  chosenId: string | null;
  /** `null` = back to the cockpit's own picker (it offers that when there is
   *  more than one candidate). */
  onChoose: (eventId: string | null) => void;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <div className="po-scroll min-h-0 flex-1 overflow-y-auto px-[38px] pb-7 pt-[30px]">
        <EventDayCockpitGate chosenId={chosenId} onChoose={onChoose} />
      </div>
    </div>
  );
}

/**
 * Picks the Door-tab variant (decision 14, N6): the outbox door for a coarse
 * pointer OR a viewport under 1024px, the cockpit only for a fine pointer at
 * ≥1024px — so an iPad in landscape gets the sidebar chrome AND the outbox.
 *
 * Latched (`useLatchedDoorVariant`): once this mount has shown the outbox it
 * keeps it until the user leaves the door tab, so a pointer change or a resize
 * mid-shift can never unmount a live `DoorProvider`. The shell mounts
 * `ssr: false`, so the first render already reads the real media queries; the
 * `null` branch is only a safety net and mounts neither variant.
 */
export function PoDoorBranch({
  doorState,
  doorEventIdFromUrl,
  doorNav,
  onChooseCockpitEvent,
}: {
  doorState: DoorOverrideState;
  doorEventIdFromUrl: string | null;
  doorNav: DoorNav;
  onChooseCockpitEvent: (eventId: string | null) => void;
}): ReactNode {
  const variant = useLatchedDoorVariant();
  if (variant === null) return <DoorTabState title={t.door.checkinTitle} text={t.common.loading} />;
  if (variant === 'cockpit') {
    return <DesktopCockpitBranch chosenId={doorEventIdFromUrl} onChoose={onChooseCockpitEvent} />;
  }
  return <MobileDoorBranch doorState={doorState} doorNav={doorNav} />;
}

/**
 * T6 auto-open (decided 1/7): on the FIRST visit of this browser session (per
 * user), when the cockpit variant applies (fine pointer at ≥1024px, decision
 * 14) and there is exactly ONE event inside its door
 * window (start − 1h through event end) AND the user landed on the bare Start
 * tab, replace it with the Door tab — the Event-day cockpit. Two or more
 * simultaneous nights → no guessing, land normally. It runs ONCE per session
 * (sessionStorage flag), so deliberately navigating away never pushes the user
 * back; a mid-session refresh doesn't re-trigger either. A `router.replace` —
 * no history entry: this replaces the landing, it isn't a step the back button
 * should undo. Gated to the Start tab (G1): a deep link into another screen on
 * the first visit must never be hijacked into the cockpit.
 *
 * Renders nothing. It lives in its own component (86eykm76k) precisely because
 * it needs `usePoDoorCandidates` while the user is NOT on the door tab — the one
 * reason the shell root used to read that query. Mounted only when the desktop
 * door applies (the cockpit variant), so its variant/`showDoor` guards are
 * structural too.
 */
export function DesktopDoorAutoOpen({
  userId,
  isStartTab,
  replaceUrl,
}: {
  userId: string | null;
  isStartTab: boolean;
  replaceUrl: (url: string) => void;
}): null {
  const doorCandidatesQuery = usePoDoorCandidates();
  const autoOpenTried = useRef(false);
  useEffect(() => {
    if (autoOpenTried.current) return;
    // `doorCandidatesQuery.data` is never undefined (usePoDoorCandidates'
    // stable-empty-array fallback, 86ey9e9vc) — an undefined-ness check here
    // can no longer distinguish "still loading" from "loaded, zero events",
    // so this used to consume the one-shot evaluation on the FIRST render
    // (candidates still loading, `cands` already `[]`) with nothing to open,
    // permanently arming the sessionStorage flag before the real candidate
    // list ever arrived — the auto-open silently never fired (review round
    // 2, Blocker 2). Gate on the query's own success state instead.
    if (!doorCandidatesQuery.isSuccess) return; // wait for candidates before consuming the one evaluation
    // Consume the one-shot evaluation NOW, regardless of which tab this turns
    // out to be (G1 review fix): stamping this only inside the Start-tab branch
    // left the flag armed for a session whose first landing was a deep link
    // elsewhere, so a later deliberate tap on Home would still get hijacked
    // into the cockpit.
    autoOpenTried.current = true;
    const KEY = `po:eventday-auto:${userId}`;
    try {
      if (sessionStorage.getItem(KEY)) return;
      sessionStorage.setItem(KEY, '1');
    } catch {
      return; // no sessionStorage → skip rather than re-push on every mount
    }
    if (!isStartTab) return;
    const id = autoOpenDoorEvent(doorCandidatesQuery.data, Date.now());
    if (!id) return;
    replaceUrl(doorPath({ seg: 'deur', eventId: id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot landing tweak
  }, [doorCandidatesQuery.isSuccess, doorCandidatesQuery.data, userId, isStartTab]);
  return null;
}
