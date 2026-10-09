import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureShareFromLocation,
  clearSharedText,
  peekSharedText,
  putSharedText,
  sharedTextFromParams,
  SHARED_TEXT_MAX,
} from './share-inbox';

/** A fake window: just the two members captureShareFromLocation touches. */
function fakeWin(href: string) {
  const state = { __NA: true };
  const replaceState = vi.fn();
  return {
    win: { location: { href } as Location, history: { state, replaceState } as unknown as History },
    replaceState,
    state,
  };
}

/** Read, then clear — what one test expects to find in the inbox. */
function takeSharedText(): string | null {
  const v = peekSharedText();
  clearSharedText();
  return v;
}

afterEach(() => {
  clearSharedText();
});

describe('share inbox (in memory)', () => {
  it('keeps the text across reads until it is cleared (the native S6 entry point)', () => {
    putSharedText('Milan +2\nFleur');
    expect(peekSharedText()).toBe('Milan +2\nFleur');
    expect(peekSharedText()).toBe('Milan +2\nFleur'); // a remount reads it again
    clearSharedText();
    expect(peekSharedText()).toBeNull();
  });

  it('ignores empty shares and lets a newer share replace an unread one', () => {
    putSharedText('   ');
    expect(takeSharedText()).toBeNull();
    putSharedText('old');
    putSharedText('new');
    expect(takeSharedText()).toBe('new');
  });

  it('caps an oversized share', () => {
    putSharedText('x'.repeat(SHARED_TEXT_MAX + 10));
    expect(takeSharedText()).toHaveLength(SHARED_TEXT_MAX);
  });
});

describe('sharedTextFromParams', () => {
  it('prefers text, falls back to title, never uses url', () => {
    expect(sharedTextFromParams(new URLSearchParams({ title: 'Friday', text: 'Milan +2' }))).toBe('Milan +2');
    expect(sharedTextFromParams(new URLSearchParams({ title: 'Milan +2' }))).toBe('Milan +2');
    expect(sharedTextFromParams(new URLSearchParams({ url: 'https://x.test' }))).toBeNull();
  });
});

describe('captureShareFromLocation', () => {
  it('moves ?text= into the inbox and rewrites the URL without it (state null so Next syncs its router)', () => {
    const { win, replaceState } = fakeWin('https://app.test/app/share?text=Milan%20Hendriks%20%2B2%0AFleur&title=List');
    captureShareFromLocation(win);
    expect(takeSharedText()).toBe('Milan Hendriks +2\nFleur');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app/share');
  });

  it('keeps unrelated query keys and reads a #text= fragment', () => {
    const { win, replaceState } = fakeWin('https://app.test/app/share?keep=1#text=Sem%20%2B1');
    captureShareFromLocation(win);
    expect(takeSharedText()).toBe('Sem +1');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app/share?keep=1');
  });

  it('strips an empty share from the URL without filling the inbox', () => {
    const { win, replaceState } = fakeWin('https://app.test/app/share?text=&url=https%3A%2F%2Fx.test');
    captureShareFromLocation(win);
    expect(takeSharedText()).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app/share');
  });

  it('is a no-op without share keys or without a window', () => {
    const { win, replaceState } = fakeWin('https://app.test/app/share');
    captureShareFromLocation(win);
    captureShareFromLocation(undefined);
    expect(replaceState).not.toHaveBeenCalled();
    expect(takeSharedText()).toBeNull();
  });

  it('still captures when the webview refuses replaceState', () => {
    const { win, replaceState } = fakeWin('https://app.test/app/share?text=Noor');
    replaceState.mockImplementation(() => {
      throw new Error('SecurityError');
    });
    captureShareFromLocation(win);
    expect(takeSharedText()).toBe('Noor');
  });
});
