import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureShareFromLocation,
  dropShareFragment,
  clearSharedText,
  peekSharedText,
  putSharedText,
  sharedTextFromParams,
  SHARED_TEXT_MAX,
} from './share-inbox';

/** A fake window: just the members captureShareFromLocation touches. */
function fakeWin(href: string) {
  const state = { __NA: true };
  const replaceState = vi.fn();
  const replace = vi.fn();
  return {
    win: { location: { href, replace } as unknown as Location, history: { state, replaceState } as unknown as History },
    replaceState,
    replace,
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
  it('fragment (the service-worker path): captures, then drops only the fragment', () => {
    const { win, replaceState, replace } = fakeWin('https://app.test/app/share?keep=1#text=Sem%20%2B1&title=List');
    expect(captureShareFromLocation(win)).toBe('captured');
    expect(takeSharedText()).toBe('Sem +1');
    // `null` state so Next syncs its router URL (server actions POST to it).
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app/share?keep=1');
    expect(replace).not.toHaveBeenCalled();
  });

  it('query (no service worker): replaces the document with the fragment form instead of replaceState (review S1)', () => {
    const { win, replaceState, replace } = fakeWin('https://app.test/app/share?text=Milan%20Hendriks%20%2B2%0AFleur&title=List');
    expect(captureShareFromLocation(win)).toBe('reloading');
    // Next built this document's router tree with the query; replaceState would
    // copy that tree (and the text) into the new history entry.
    expect(replaceState).not.toHaveBeenCalled();
    expect(takeSharedText()).toBeNull(); // the fresh document captures it
    expect(replace).toHaveBeenCalledTimes(1);
    const target = new URL(replace.mock.calls[0][0] as string, 'https://app.test');
    expect(target.pathname + target.search).toBe('/app/share');
    const fragment = new URLSearchParams(target.hash.slice(1));
    expect(fragment.get('text')).toBe('Milan Hendriks +2\nFleur');
    expect(fragment.get('title')).toBe('List');
  });

  it('query: other keys stay in the query of the replacement', () => {
    const { win, replace } = fakeWin('https://app.test/app/share?keep=1&text=Noor');
    captureShareFromLocation(win);
    expect(replace).toHaveBeenCalledWith('/app/share?keep=1#text=Noor');
  });

  it('an empty share is cleaned without filling the inbox', () => {
    const { win, replaceState } = fakeWin('https://app.test/app/share#text=&url=https%3A%2F%2Fx.test');
    expect(captureShareFromLocation(win)).toBe('captured');
    expect(takeSharedText()).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app/share');
  });

  it('is a no-op without share keys or without a window', () => {
    const { win, replaceState, replace } = fakeWin('https://app.test/app/share');
    expect(captureShareFromLocation(win)).toBe('none');
    expect(captureShareFromLocation(undefined)).toBe('none');
    expect(replaceState).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(takeSharedText()).toBeNull();
  });

  it('a webview that refuses the navigation still captures, in place', () => {
    const { win, replaceState, replace } = fakeWin('https://app.test/app/share?text=Noor');
    replace.mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(captureShareFromLocation(win)).toBe('captured');
    expect(takeSharedText()).toBe('Noor');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app/share');
  });

  it('a webview that refuses replaceState still captures', () => {
    const { win, replaceState } = fakeWin('https://app.test/app/share#text=Noor');
    replaceState.mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(captureShareFromLocation(win)).toBe('captured');
    expect(takeSharedText()).toBe('Noor');
  });
});

describe('dropShareFragment (the /login a signed-out share lands on, review S3)', () => {
  it('drops an inherited share fragment unread and keeps next=', () => {
    const { win, replaceState } = fakeWin('https://app.test/login?next=%2Fapp%2Fshare#text=Iris%20Koster%20%2B1');
    expect(dropShareFragment(win)).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/login?next=%2Fapp%2Fshare');
    expect(peekSharedText()).toBeNull(); // never read into the inbox
  });

  it('leaves any other fragment alone', () => {
    const { win, replaceState } = fakeWin('https://app.test/login#top');
    expect(dropShareFragment(win)).toBe(false);
    expect(dropShareFragment(undefined)).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });
});
