/**
 * Local, diacritic-insensitive fuzzy search for the door (spec §4 point 6 +
 * decision #27: searching is always local, never network-bound). Substring match
 * first, then a forgiving subsequence match ("jrbr" → "Juri Braakman"); names are
 * also matchable by the last 4 phone digits.
 */

export function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** True when `query` matches `target` as a substring or a subsequence. */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const t = normalize(target);
  if (t.includes(q)) return true;
  if (q.length < 2) return false;
  // Subsequence: every query char appears in order somewhere in the target.
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i++;
  }
  return i === q.length;
}

export interface Searchable {
  name: string;
  last4: string | null;
}

export function filterBySearch<T extends Searchable>(items: T[], query: string): T[] {
  const q = normalize(query);
  if (!q) return items;
  const digits = q.replace(/\D/g, '');
  return items.filter(
    (it) => fuzzyMatch(q, it.name) || (digits.length >= 2 && it.last4 != null && it.last4.includes(digits)),
  );
}
