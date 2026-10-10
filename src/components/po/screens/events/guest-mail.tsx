'use client';

// Guest-mail section of the event edit screen (Gastcommunicatie F,
// z8uq9m2vpy): the house rules shown in "You're on the list", and the
// platform-admin "Send reminder" test (GUEST_REMINDER_ENABLED). Own file and
// own save, so the event form (and task 3b's location work in edit.tsx) stays
// untouched. Edit mode only: a new event gets its house rules once it exists.

import { type JSX, useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import {
  usePoGuestReminderAvailable,
  usePoHouseRules,
  usePoSaveHouseRules,
  usePoSendGuestReminder,
} from '@/features/po/guest-mail';
import { HOUSE_RULES_MAX } from '@/features/events/schemas';
import { Btn, Label, TextArea } from '../../kit';

export function EventGuestMailSection({ eventId, writable }: { eventId: string; writable: boolean }): JSX.Element {
  const g = t.events.guestMail;
  const rulesQ = usePoHouseRules(eventId);
  const saveRules = usePoSaveHouseRules(eventId);
  const reminderQ = usePoGuestReminderAvailable();
  const reminder = usePoSendGuestReminder(eventId);
  const [rules, setRules] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (rulesQ.data !== undefined && !loaded) {
      setRules(rulesQ.data);
      setLoaded(true);
    }
  }, [rulesQ.data, loaded]);

  const dirty = loaded && rules.trim() !== (rulesQ.data ?? '').trim();

  return (
    <section data-testid="event-guest-mail" className="mb-[18px]">
      <Label className="mb-2">{g.houseRulesLabel}</Label>
      <TextArea
        value={rules}
        onChange={writable ? setRules : () => undefined}
        placeholder={g.houseRulesPlaceholder}
        ariaLabel={g.houseRulesLabel}
        maxLength={HOUSE_RULES_MAX}
        rows={2}
      />
      <div className="mb-2 mt-1 text-[12.5px] leading-[1.45] text-faint">{g.houseRulesHint}</div>
      {saveRules.isError && (
        <p className="mb-2 text-[12.5px] text-red-300" role="alert">
          {saveRules.error.message}
        </p>
      )}
      {saveRules.isSuccess && !dirty && <p className="mb-2 text-[12.5px] text-acc-soft">{g.houseRulesSaved}</p>}
      {writable && dirty && (
        <Btn kind="dark" full icon="check" disabled={saveRules.isPending} onClick={() => saveRules.mutate(rules)}>
          {saveRules.isPending ? g.houseRulesSaving : g.houseRulesSave}
        </Btn>
      )}

      {reminderQ.data === true && (
        <div data-testid="guest-reminder" className="mt-[18px] rounded-[18px] border border-line bg-elev p-4">
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
      )}
    </section>
  );
}
