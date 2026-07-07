import { describe, it, expect } from 'vitest';
import { classifyAddResult, summarizeBulkAdd, type BulkAddRowResult } from './bulk';

describe('classifyAddResult', () => {
  it('maps a successful add to "added"', () => {
    expect(classifyAddResult({ ok: true }, false)).toBe('added');
  });

  it('maps the quota SQLSTATEs to "quota"', () => {
    expect(classifyAddResult({ ok: false, code: '45001' }, false)).toBe('quota');
    expect(classifyAddResult({ ok: false, code: '45005' }, false)).toBe('quota');
  });

  it('maps tier-full (45002) to "tierFull"', () => {
    expect(classifyAddResult({ ok: false, code: '45002' }, false)).toBe('tierFull');
  });

  it('reports 42501 as "locked" only when the target list is locked, else "error"', () => {
    expect(classifyAddResult({ ok: false, code: '42501' }, true)).toBe('locked');
    expect(classifyAddResult({ ok: false, code: '42501' }, false)).toBe('error');
  });

  it('falls back to "error" for anything else', () => {
    expect(classifyAddResult({ ok: false, code: '23505' }, false)).toBe('error');
    expect(classifyAddResult({ ok: false, code: 'unknown' }, true)).toBe('error');
  });
});

describe('summarizeBulkAdd', () => {
  it('counts each outcome, zero-filling the rest', () => {
    const rows: BulkAddRowResult[] = [
      { key: 'a', name: 'A', outcome: 'added' },
      { key: 'b', name: 'B', outcome: 'added' },
      { key: 'c', name: 'C', outcome: 'already' },
      { key: 'd', name: 'D', outcome: 'quota' },
    ];
    expect(summarizeBulkAdd(rows)).toEqual({
      added: 2,
      already: 1,
      quota: 1,
      tierFull: 0,
      locked: 0,
      error: 0,
    });
  });

  it('returns all-zero for an empty batch', () => {
    expect(summarizeBulkAdd([])).toEqual({
      added: 0,
      already: 0,
      quota: 0,
      tierFull: 0,
      locked: 0,
      error: 0,
    });
  });
});
