/**
 * Deterministic, offline-proof quick-add parser (#33).
 *
 * Turns free text like `"Juri Braakman +2 vip"` into a structured guest. Runs
 * fully client-side so it works at the door with no network. Crucially it never
 * silently falls back to the default tier when it meets an unknown lowercase
 * word — it flags `ambiguous` so the UI can ask.
 */

import { tiers } from './data';
import type { BulkRow, ParsedGuest, Tier } from './types';

export function parseQuickAdd(raw: string): ParsedGuest | null {
  const text = (raw || '').trim();
  if (!text) return null;

  let plus = 0;
  let work = text;

  // +N  /  "+ 2"  /  "plus 2"  /  "en 2"
  const plusMatch = work.match(/\+\s*(\d+)|plus\s+(\d+)|\ben\s+(\d+)\b/i);
  if (plusMatch) {
    plus = parseInt(plusMatch[1] || plusMatch[2] || plusMatch[3], 10) || 0;
    work = work.replace(plusMatch[0], ' ');
  }

  const tokens = work.split(/\s+/).filter(Boolean);
  const nameWords: string[] = [];
  const unknown: string[] = [];
  let tier: Tier | null = null;

  for (const tok of tokens) {
    const low = tok.toLowerCase().replace(/[.,]/g, '');
    const hit = tiers.find((t) => t.aliases.includes(low));
    if (hit) {
      tier = tier ?? hit;
    } else if (/^[A-ZÀ-Ÿ]/.test(tok)) {
      nameWords.push(tok); // capitalised → part of the name
    } else {
      unknown.push(tok); // lowercase, not a known alias → ask
    }
  }

  const resolvedTier = tier ?? tiers.find((t) => t.isDefault) ?? tiers[tiers.length - 1];

  return {
    name: nameWords.join(' ') || text,
    plus,
    tier: resolvedTier,
    unknown,
    ambiguous: unknown.length > 0,
  };
}

/** Bulk paste: one guest per line, doubtful lines flagged via `ambiguous`. */
export function parseBulk(raw: string): BulkRow[] {
  return (raw || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i): BulkRow | null => {
      const p = parseQuickAdd(line);
      return p ? { id: 'bulk' + i, raw: line, ...p } : null;
    })
    .filter((r): r is BulkRow => r !== null);
}
