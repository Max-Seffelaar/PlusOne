// @vitest-environment jsdom
/**
 * Field errors point at the field (z8uq9m5eb7): `useFieldErrors` + the kit
 * inputs' `invalid`/`describedBy`/`id`. A failure on a registered field marks
 * that input (aria-invalid, red border, message under it with role="alert",
 * linked by aria-describedby), focuses it and scrolls it into view — smooth,
 * or instant when the user asked for reduced motion. Editing the field clears
 * it. A failure without a (known) field is the banner.
 */
import '@testing-library/jest-dom';
import { useState, type JSX } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import {
  Field,
  FieldErrorFor,
  TextArea,
  fieldErrorBorder,
  fieldInputProps,
  focusFirstInvalid,
  prefersReducedMotion,
  useFieldErrors,
} from './kit';

const scrolls: ScrollIntoViewOptions[] = [];

function stubMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduce && q.includes('prefers-reduced-motion'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  scrolls.length = 0;
  Element.prototype.scrollIntoView = function (this: Element, opts?: boolean | ScrollIntoViewOptions) {
    scrolls.push(typeof opts === 'object' ? opts : {});
  } as Element['scrollIntoView'];
  stubMotion(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Form({ onFe }: { onFe?: (fe: ReturnType<typeof useFieldErrors<'name' | 'notes'>>) => void }): JSX.Element {
  const fe = useFieldErrors(['name', 'notes'] as const);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  onFe?.(fe);
  return (
    <div>
      {fe.banner && <div role="alert">{fe.banner}</div>}
      <Field ariaLabel="Name" value={name} onChange={fe.edit('name', setName)} {...fieldInputProps(fe.bind('name'))} />
      <FieldErrorFor error={fe.bind('name')} />
      <TextArea ariaLabel="Notes" value={notes} onChange={fe.edit('notes', setNotes) ?? setNotes} {...fieldInputProps(fe.bind('notes'))} />
      <FieldErrorFor error={fe.bind('notes')} />
    </div>
  );
}

function setup(): { fe: () => ReturnType<typeof useFieldErrors<'name' | 'notes'>> } {
  let current: ReturnType<typeof useFieldErrors<'name' | 'notes'>> | null = null;
  render(<Form onFe={(f) => (current = f)} />);
  return { fe: () => current! };
}

describe('useFieldErrors', () => {
  it('marks the named field, links the message, focuses and scrolls to it', () => {
    const { fe } = setup();
    act(() => fe().fail('Enter a name', 'name'));

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Enter a name');
    expect(input).toHaveAttribute('aria-describedby', alert.id);
    expect(input).toHaveAccessibleDescription('Enter a name');
    // Red border on the box, never the accent.
    expect(input.closest('[data-field-shell]')).toHaveClass(fieldErrorBorder);
    expect(document.activeElement).toBe(input);
    expect(scrolls).toEqual([{ block: 'center', inline: 'nearest', behavior: 'smooth' }]);
    // The other field stays clean.
    expect(screen.getByRole('textbox', { name: 'Notes' })).not.toHaveAttribute('aria-invalid');
  });

  it('a second failure on the same field moves there again', () => {
    const { fe } = setup();
    act(() => fe().fail('Enter a name', 'name'));
    (document.activeElement as HTMLElement).blur();
    act(() => fe().fail('Enter a name', 'name'));
    expect(scrolls).toHaveLength(2);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }));
  });

  it('editing the field clears its error', () => {
    const { fe } = setup();
    act(() => fe().fail('Too long', 'notes'));
    const notes = screen.getByRole('textbox', { name: 'Notes' });
    expect(notes).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(notes, { target: { value: 'shorter' } });
    expect(notes).not.toHaveAttribute('aria-invalid');
    expect(notes).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('editing ANOTHER field keeps the error', () => {
    const { fe } = setup();
    act(() => fe().fail('Enter a name', 'name'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'x' } });
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('no field, or a field the form does not render: the banner, nothing marked or scrolled', () => {
    const { fe } = setup();
    act(() => fe().fail("You don't have rights for this."));
    expect(fe().banner).toBe("You don't have rights for this.");
    expect(document.querySelector('[aria-invalid]')).toBeNull();
    act(() => fe().fail('Invalid id', 'venueId'));
    expect(fe().banner).toBe('Invalid id');
    expect(fe().field).toBeNull();
    expect(scrolls).toHaveLength(0);
  });

  it('a field error replaces the banner, and reset clears both', () => {
    const { fe } = setup();
    act(() => fe().fail('Network'));
    act(() => fe().fail('Enter a name', 'name'));
    expect(fe().banner).toBeNull();
    act(() => fe().reset());
    expect(document.querySelector('[aria-invalid]')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('reduced motion', () => {
  it('scrolls without smooth animation when the user asked for less motion', () => {
    stubMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    const { fe } = setup();
    act(() => fe().fail('Enter a name', 'name'));
    expect(scrolls).toEqual([{ block: 'center', inline: 'nearest', behavior: 'auto' }]);
  });

  it('no matchMedia (old webview): treated as no preference, never throws', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('focusFirstInvalid', () => {
  it('focuses the first aria-invalid input under the root', () => {
    render(
      <div data-testid="root">
        <Field ariaLabel="A" value="" onChange={() => {}} />
        <Field ariaLabel="B" value="" onChange={() => {}} invalid id="b" />
      </div>,
    );
    expect(focusFirstInvalid(screen.getByTestId('root'))).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'B' }));
    expect(scrolls).toHaveLength(1);
  });

  it('is false when nothing is invalid', () => {
    render(<Field ariaLabel="A" value="" onChange={() => {}} />);
    expect(focusFirstInvalid()).toBe(false);
  });
});
