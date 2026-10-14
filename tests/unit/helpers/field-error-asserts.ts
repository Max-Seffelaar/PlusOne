/**
 * The #498 field-error contract, asserted the same way on every form
 * (z8uq9m5eb7, z8uq9m5m8g): the input is marked (aria-invalid), its message
 * sits right under it in a role="alert" element that the input names through
 * aria-describedby, the input has focus and was scrolled into view, and —
 * because the error has a field — no banner says it again.
 *
 * Needs jsdom, `@testing-library/jest-dom`, and `stubScrollIntoView()` in a
 * beforeEach (jsdom has no scrollIntoView).
 */
import { expect } from 'vitest';

export const scrolledInto: Element[] = [];

/** jsdom has no scrollIntoView: record the boxes the kit scrolled to. */
export function stubScrollIntoView(): void {
  scrolledInto.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolledInto.push(this);
  } as Element['scrollIntoView'];
}

/** `input` holds the field error `message`, has focus, and no banner repeats it. */
export function expectFieldError(input: HTMLElement, message: string, opts: { focused?: boolean } = {}): void {
  expect(input).toHaveAttribute('aria-invalid', 'true');
  const describedBy = input.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  const note = document.getElementById(describedBy ?? '');
  expect(note).not.toBeNull();
  expect(note).toHaveTextContent(message);
  expect(note).toHaveAttribute('role', 'alert');
  if (opts.focused ?? true) {
    expect(document.activeElement).toBe(input);
    const box = input.closest('[data-field-shell]') ?? input;
    expect(scrolledInto).toContain(box);
  }
  // No banner: every alert on the page is a field message under its input.
  const alerts = Array.from(document.querySelectorAll('[role="alert"]'));
  const fieldNotes = new Set(
    Array.from(document.querySelectorAll('[aria-describedby]'))
      .map((el) => el.getAttribute('aria-describedby'))
      .filter(Boolean),
  );
  for (const a of alerts) expect(fieldNotes.has(a.id)).toBe(true);
}

/** A field that is fine: not marked, nothing describes it. */
export function expectFieldOk(input: HTMLElement): void {
  expect(input).not.toHaveAttribute('aria-invalid', 'true');
  expect(input.getAttribute('aria-describedby')).toBeNull();
}
