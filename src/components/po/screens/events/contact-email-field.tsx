'use client';

// The event's contact address (Gastcommunicatie F, PR 6c, z8uq9m2vpy; decision
// Max 2026-10-10). Required on every create and save, typed by the organiser:
// never pre-filled from the company address or a template. Guests see it in
// every mail about this event and their replies land there. The form checks
// the syntax; the server checks it again plus the domain (DNS, fail-open).

import type { JSX } from 'react';
import { t } from '@/lib/i18n';
import { CONTACT_EMAIL_MAX, contactEmailField } from '@/features/events/schemas';
import { Field, Label } from '../../kit';

/** The message to show for `value`, or null when it may be saved. */
export function contactEmailProblem(value: string): string | null {
  const parsed = contactEmailField.safeParse(value);
  return parsed.success ? null : parsed.error.issues[0]?.message ?? t.events.contactEmail.invalid;
}

/** The normalised address the actions take (trimmed, lower-cased). */
export function contactEmailValue(value: string): string {
  return value.trim().toLowerCase();
}

export function EventContactEmailField({
  value,
  onChange,
}: {
  value: string;
  /** Undefined = read-only (a role that can't edit this event). */
  onChange?: (v: string) => void;
}): JSX.Element {
  return (
    <div data-testid="event-contact-email">
      <Label className="mb-2">{t.events.contactEmail.label}</Label>
      <Field
        icon="mail"
        type="email"
        inputMode="email"
        ariaLabel={t.events.contactEmail.label}
        placeholder={t.events.contactEmail.placeholder}
        value={value}
        onChange={onChange}
        maxLength={CONTACT_EMAIL_MAX}
        className="mb-2"
      />
      <div className="mb-[18px] text-[12.5px] leading-[1.45] text-faint">{t.events.contactEmail.hint}</div>
    </div>
  );
}
