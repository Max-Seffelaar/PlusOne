'use client';

// Guest-mail parts of the event edit screen (Gastcommunicatie F, z8uq9m2vpy).
//   * EventGuestTextFields: the "For your guests" block. House rules (rules
//     at the door: age, ID, dress code) and info for guests (practical:
//     parking, entrance, cloakroom), one under the other (z8uq9m4a5n
//     follow-up, decision Max 2026-10-12). Controlled by the event form, so
//     both save with the event, on create and on edit.
//   * EventGuestMailSection: the platform-admin "Send reminder" test
//     (GUEST_REMINDER_ENABLED), edit mode only.

import type { JSX } from 'react';
import { t } from '@/lib/i18n';
import { usePoGuestReminderAvailable, usePoSendGuestReminder } from '@/features/po/guest-mail';
import { GUEST_INFO_MAX, HOUSE_RULES_MAX } from '@/features/events/schemas';
import { Btn, Label, TextArea } from '../../kit';

const hintClass = 'mt-1 text-[12.5px] leading-[1.45] text-faint';

export function EventGuestTextFields({
  houseRules,
  guestInfo,
  onHouseRulesChange,
  onGuestInfoChange,
}: {
  houseRules: string;
  guestInfo: string;
  /** Undefined = read-only (a role that can't edit this event). */
  onHouseRulesChange?: (v: string) => void;
  onGuestInfoChange?: (v: string) => void;
}): JSX.Element {
  const g = t.events.guestMail;
  return (
    <section data-testid="event-guest-text" aria-label={g.blockTitle} className="mb-[18px] rounded-[18px] border border-line bg-elev p-4">
      <div className="mb-3 font-body text-[14.5px] font-semibold text-text">{g.blockTitle}</div>

      <div data-testid="event-house-rules">
        <Label className="mb-2">{g.houseRulesLabel}</Label>
        <TextArea
          value={houseRules}
          onChange={onHouseRulesChange ?? (() => undefined)}
          placeholder={g.houseRulesPlaceholder}
          ariaLabel={g.houseRulesLabel}
          maxLength={HOUSE_RULES_MAX}
          rows={2}
        />
        <div className={`mb-4 ${hintClass}`}>{g.houseRulesHint}</div>
      </div>

      <div data-testid="event-guest-info">
        <Label className="mb-2">{t.events.guestInfoLabel}</Label>
        <TextArea
          value={guestInfo}
          onChange={onGuestInfoChange ?? (() => undefined)}
          placeholder={t.events.guestInfoPlaceholder}
          ariaLabel={t.events.guestInfoLabel}
          maxLength={GUEST_INFO_MAX}
          rows={3}
        />
        <div className={hintClass}>{t.events.guestInfoHint}</div>
      </div>
    </section>
  );
}

export function EventGuestMailSection({ eventId }: { eventId: string }): JSX.Element | null {
  const g = t.events.guestMail;
  const reminderQ = usePoGuestReminderAvailable();
  const reminder = usePoSendGuestReminder(eventId);
  if (reminderQ.data !== true) return null;
  return (
    <section data-testid="event-guest-mail" className="mb-[18px]">
      <div data-testid="guest-reminder" className="rounded-[18px] border border-line bg-elev p-4">
        <div className="font-body text-[14.5px] font-semibold text-text">{g.reminderTitle}</div>
        <div className="mb-3 mt-0.5 text-[12px] leading-[1.4] text-faint">{g.reminderSub}</div>
        {reminder.isError && (
          <p className="mb-2 text-[12.5px] text-red-300" role="alert">
            {reminder.error.message}
          </p>
        )}
        {reminder.isSuccess ? (
          <p className="text-[12.5px] text-acc-soft">{g.reminderSent}</p>
        ) : (
          <Btn kind="ghost" full icon="mail" disabled={reminder.isPending} onClick={() => reminder.mutate()}>
            {reminder.isPending ? g.reminderSending : g.reminderSend}
          </Btn>
        )}
      </div>
    </section>
  );
}
