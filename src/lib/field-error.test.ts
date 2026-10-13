/**
 * Field-scoped errors (z8uq9m5eb7): the server's `{ message, field }` and a
 * client Zod refusal reach the form in one shape, and the React Query layer
 * keeps the field on the thrown error.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { invalidInput, invalidIssues, mapMutationError } from './db-errors';
import { FieldActionError, errorField, errorFields, firstIssueField, issueFields } from './field-error';
import { createEventSchema, updateEventSchema } from '@/features/events/schemas';
import { t } from '@/lib/i18n';

describe('firstIssueField', () => {
  it('is the top-level key of the first issue', () => {
    const r = z.object({ a: z.string().min(1, 'A'), b: z.string().min(1, 'B') }).safeParse({ a: '', b: '' });
    expect(r.success).toBe(false);
    if (!r.success) expect(firstIssueField(r.error.issues)).toBe('a');
  });

  it('is undefined for a root-level issue or no issues', () => {
    const r = z.string().min(3).safeParse('x');
    if (!r.success) expect(firstIssueField(r.error.issues)).toBeUndefined();
    expect(firstIssueField([])).toBeUndefined();
  });
});

describe('invalidIssues', () => {
  it('a missing contact address names contactEmail with the generic message', () => {
    const r = createEventSchema.safeParse({
      venueId: '0193f1a2-0000-7000-8000-000000000001',
      name: 'Night',
      startsAt: '2026-10-16T21:00:00.000Z',
      contactEmail: '',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(invalidIssues(r.error)).toEqual({
        ok: false,
        code: 'invalid',
        message: t.events.contactEmail.required,
        field: 'contactEmail',
      });
    }
  });

  it('the end-after-start refine names endsAt', () => {
    const r = updateEventSchema.safeParse({
      eventId: '0193f1a2-0000-7000-8000-000000000001',
      startsAt: '2026-10-16T21:00:00.000Z',
      endsAt: '2026-10-16T20:00:00.000Z',
    });
    if (!r.success) expect(invalidIssues(r.error).field).toBe('endsAt');
    else throw new Error('expected a refusal');
  });

  it('never echoes the input back', () => {
    const r = createEventSchema.safeParse({
      venueId: '0193f1a2-0000-7000-8000-000000000001',
      name: 'Night',
      startsAt: '2026-10-16T21:00:00.000Z',
      contactEmail: 'secret-typed-value',
    });
    if (!r.success) expect(JSON.stringify(invalidIssues(r.error))).not.toContain('secret-typed-value');
    else throw new Error('expected a refusal');
  });
});

describe('invalidInput / mapMutationError', () => {
  it('a field is optional: existing call sites keep their shape', () => {
    expect(invalidInput()).toEqual({ ok: false, code: 'invalid', message: 'Check the details you entered.' });
    expect(invalidInput('Nope')).not.toHaveProperty('field');
    expect(invalidInput('Nope', 'name')).toMatchObject({ field: 'name' });
    expect(mapMutationError({ code: '42501' })).not.toHaveProperty('field');
  });
});

describe('FieldActionError', () => {
  it('is an Error with the message, and carries the field', () => {
    const e = new FieldActionError('Add a contact email for guests.', 'contactEmail');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('Add a contact email for guests.');
    expect(errorField(e)).toBe('contactEmail');
  });

  it('no field: errorField is undefined, also for plain errors', () => {
    expect(errorField(new FieldActionError('Something went wrong. Try again.'))).toBeUndefined();
    expect(errorField(new Error('x'))).toBeUndefined();
    expect(errorField('x')).toBeUndefined();
  });
});

describe('every field with an issue (z8uq9m5m8g)', () => {
  const schema = z.object({ a: z.string().min(1, 'A'), b: z.string().min(1, 'B'), c: z.string().min(1, 'C') });

  it('invalidIssues names the first field and lists every field with its first message', () => {
    const r = schema.safeParse({ a: '', b: 'ok', c: '' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(invalidIssues(r.error)).toEqual({ ok: false, code: 'invalid', message: 'A', field: 'a', fields: { a: 'A', c: 'C' } });
    }
  });

  it('one field keeps the old shape: no `fields`', () => {
    const r = schema.safeParse({ a: 'ok', b: '', c: 'ok' });
    if (!r.success) expect(invalidIssues(r.error)).toEqual({ ok: false, code: 'invalid', message: 'B', field: 'b' });
  });

  it('issueFields keeps the first message per key and skips root-level issues', () => {
    expect(
      issueFields([
        { path: ['x'], message: 'first' },
        { path: ['x'], message: 'second' },
        { path: [], message: 'root' },
        { path: ['y', 0], message: 'nested' },
      ]),
    ).toEqual({ x: 'first', y: 'nested' });
    expect(issueFields([{ path: ['x'], message: 'only' }])).toBeUndefined();
  });

  it('FieldActionError carries fields; errorFields reads them, plain errors give undefined', () => {
    const e = new FieldActionError('A', 'a', { a: 'A', c: 'C' });
    expect(errorFields(e)).toEqual({ a: 'A', c: 'C' });
    expect(errorFields(new Error('x'))).toBeUndefined();
    expect(new FieldActionError('A', 'a').fields).toBeUndefined();
  });
});
