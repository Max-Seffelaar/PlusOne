/**
 * Field-scoped errors (z8uq9m5eb7). A failed save that is about ONE field
 * names that field, so the form can scroll to it, mark it and say what is
 * wrong right under it instead of in a banner at the top.
 *
 * The `field` is always a schema key the code chose ("contactEmail",
 * "endsAt"), never anything the user typed: a message stays generic and no
 * input is echoed back (CLAUDE.md security checklist). Server actions return
 * it beside `message` (`MutationError.field`, `src/lib/db-errors.ts`); client
 * Zod checks and the React Query layer carry it the same way, so both paths
 * reach the form in one shape. Safe on the server and in the browser.
 */

interface IssueLike {
  path: readonly PropertyKey[];
  message: string;
}

/** The top-level key of the first Zod issue, when it names one. */
export function firstIssueField(issues: readonly IssueLike[]): string | undefined {
  const head = issues[0]?.path[0];
  return typeof head === 'string' ? head : undefined;
}

/** Every field a set of errors marks: field (schema key) → its message. */
export type FieldMessages = Readonly<Record<string, string>>;

/**
 * Every top-level key that has a Zod issue, with that key's first message, in
 * issue order (z8uq9m5m8g). Only when the issues name MORE than one field:
 * a single field is already `firstIssueField`, so a one-field result keeps the
 * exact shape it had before.
 */
export function issueFields(issues: readonly IssueLike[]): FieldMessages | undefined {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const head = issue.path[0];
    if (typeof head === 'string' && !(head in out)) out[head] = issue.message;
  }
  return Object.keys(out).length > 1 ? out : undefined;
}

/**
 * What React Query mutations throw for a failed server action
 * (`throwOnError` in `src/features/po/mutations.ts`): an ordinary Error, so
 * every existing `e instanceof Error ? e.message` keeps working, plus the
 * field the action named.
 */
export class FieldActionError extends Error {
  readonly field?: string;
  /** Every field the action marked, when it marked more than one. */
  readonly fields?: FieldMessages;
  constructor(message: string, field?: string, fields?: FieldMessages) {
    super(message);
    this.name = 'FieldActionError';
    if (field) this.field = field;
    if (fields) this.fields = fields;
  }
}

/** The field a thrown error is about, if any. */
export function errorField(e: unknown): string | undefined {
  return e instanceof FieldActionError ? e.field : undefined;
}

/** Every field a thrown error marks (more than one), if any. */
export function errorFields(e: unknown): FieldMessages | undefined {
  return e instanceof FieldActionError ? e.fields : undefined;
}
