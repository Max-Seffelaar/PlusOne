/**
 * The event form's field keys for `useFieldErrors` (z8uq9m5eb7), and how a
 * server action's `field` (a schema key) maps onto the input that shows it.
 * Most keys are the same on both sides; the schedule is one ISO instant on
 * the server and two inputs (date + time) in the form.
 */
export const EVENT_FORM_FIELDS = [
  'name',
  'date',
  'time',
  'endDate',
  'endTime',
  'locationName',
  'locationAddress',
  'houseRules',
  'guestInfo',
  'contactEmail',
  'autoDate',
  'autoTime',
] as const;
export type EventFormField = (typeof EVENT_FORM_FIELDS)[number];

const SERVER_TO_FORM: Record<string, EventFormField> = {
  startsAt: 'date',
  // The end-after-start refine sits on endsAt; the time is what usually needs changing.
  endsAt: 'endTime',
  autoLockAt: 'autoDate',
};

/** The form input a server-side `field` points at; unknown keys pass through (and land in the banner). */
export function eventFormField(field: string | undefined): string | undefined {
  return field ? SERVER_TO_FORM[field] ?? field : undefined;
}
