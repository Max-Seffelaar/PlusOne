'use client';

// Profile → Notifications (Gastcommunicatie F, PR 6b, z8uq9m2vpy; decision Max
// 2026-10-06): how PlusOne tells this user about requests. Per kind push on/off
// and email right away / daily summary / off, plus the daily summary itself.
// Only the kinds the user can act on are shown: guest-list requests for an
// admin or event organizer, quota requests for an admin, answers to their own
// quota requests for anyone. Saves on every change. The device-level push
// switch (PushSettingsRow) stays where it is: this is the account preference.

import type { JSX } from 'react';
import { t } from '@/lib/i18n';
import { usePoNotificationPrefs, usePoSaveNotificationPrefs } from '@/features/po/notification-prefs';
import type { EmailMode, NotificationPrefs } from '@/features/notifications/prefs-schema';
import { Label, Seg, Toggle } from '../../kit';

const P = () => t.notifications.prefs;

function KindBlock({
  title,
  sub,
  push,
  onPush,
  email,
  testId,
  last,
}: {
  title: string;
  sub: string;
  push: boolean;
  onPush: (v: boolean) => void;
  email: JSX.Element;
  testId: string;
  last?: boolean;
}): JSX.Element {
  const p = P();
  return (
    <div data-testid={testId} className={last ? 'py-[13px]' : 'border-b border-line2 py-[13px]'}>
      <div className="font-body text-[14.5px] font-semibold text-text">{title}</div>
      <div className="mt-0.5 text-[12px] leading-[1.4] text-faint">{sub}</div>
      <div className="mt-[10px] flex items-center gap-[12px]">
        <span className="w-[52px] text-[12.5px] text-dim">{p.push}</span>
        <Toggle on={push} onClick={() => onPush(!push)} ariaLabel={`${title}: ${p.push}`} />
      </div>
      <div className="mt-[10px] flex items-center gap-[12px]">
        <span className="w-[52px] shrink-0 text-[12.5px] text-dim">{p.email}</span>
        <div className="min-w-0 flex-1">{email}</div>
      </div>
    </div>
  );
}

export function NotificationPrefsSection({
  canDecideRequests,
  isAdmin,
}: {
  /** Admin, or organizer of an event here: guest-list requests reach them. */
  canDecideRequests: boolean;
  isAdmin: boolean;
}): JSX.Element | null {
  const p = P();
  const q = usePoNotificationPrefs();
  const save = usePoSaveNotificationPrefs();
  const prefs = q.data;
  if (!prefs) return null;

  const set = (change: (p: NotificationPrefs) => NotificationPrefs): void => save.update(change);
  const modes = [
    ['immediate', p.emailImmediate],
    ['daily', p.emailDaily],
    ['off', p.emailOff],
  ] as const satisfies readonly (readonly [EmailMode, string])[];
  const blocks: JSX.Element[] = [];

  if (canDecideRequests) {
    blocks.push(
      <KindBlock
        key="requests"
        testId="prefs-requests"
        title={p.requestsTitle}
        sub={p.requestsSub}
        push={prefs.requests.push}
        onPush={(v) => set((p) => ({ ...p, requests: { ...p.requests, push: v } }))}
        email={
          <Seg<EmailMode>
            value={prefs.requests.email}
            onChange={(v) => set((p) => ({ ...p, requests: { ...p.requests, email: v }, digest: v === 'daily' ? true : p.digest }))}
            items={modes}
            className="max-w-[360px]"
          />
        }
      />,
    );
  }
  if (isAdmin) {
    blocks.push(
      <KindBlock
        key="quota"
        testId="prefs-quota"
        title={p.quotaTitle}
        sub={p.quotaSub}
        push={prefs.quota.push}
        onPush={(v) => set((p) => ({ ...p, quota: { ...p.quota, push: v } }))}
        email={
          <Seg<EmailMode>
            value={prefs.quota.email}
            onChange={(v) => set((p) => ({ ...p, quota: { ...p.quota, email: v }, digest: v === 'daily' ? true : p.digest }))}
            items={modes}
            className="max-w-[360px]"
          />
        }
      />,
    );
  }
  blocks.push(
    <KindBlock
      key="decisions"
      testId="prefs-decisions"
      title={p.decisionsTitle}
      sub={p.decisionsSub}
      push={prefs.decisions.push}
      onPush={(v) => set((p) => ({ ...p, decisions: { ...p.decisions, push: v } }))}
      email={
        <Toggle
          on={prefs.decisions.email}
          onClick={() => set((p) => ({ ...p, decisions: { ...p.decisions, email: !p.decisions.email } }))}
          ariaLabel={`${p.decisionsTitle}: ${p.email}`}
        />
      }
      last={!canDecideRequests}
    />,
  );

  return (
    <section data-testid="notification-prefs">
      <Label className="mb-[10px] mt-[18px]">{p.title}</Label>
      <p className="mb-[10px] text-[12.5px] leading-[1.45] text-faint">{p.intro}</p>
      <div className="rounded-[18px] border border-line bg-elev px-4 py-1">
        {blocks}
        {canDecideRequests && (
          <div data-testid="prefs-digest" className="flex items-center gap-[12px] py-[13px]">
            <div className="flex-1">
              <div className="font-body text-[14.5px] font-semibold text-text">{p.digestTitle}</div>
              <div className="mt-0.5 text-[12px] leading-[1.4] text-faint">{p.digestSub}</div>
            </div>
            <Toggle on={prefs.digest} onClick={() => set((p) => ({ ...p, digest: !p.digest }))} ariaLabel={p.digestTitle} />
          </div>
        )}
      </div>
      <p className="mt-2 min-h-[18px] text-[12.5px]" aria-live="polite">
        {save.isPending ? <span className="text-faint">{p.saving}</span> : save.isError ? <span className="text-acc-soft">{p.error}</span> : save.isSuccess ? <span className="text-acc-soft">{p.saved}</span> : null}
      </p>
    </section>
  );
}
