// @vitest-environment jsdom
/**
 * Webview-safe kit helpers (Fase 17 N1, decision #37): `copyText`,
 * `useCopyText`/`copyStateLabel`, `openExternal` and `ExternalLink`.
 *
 * `copyText` must never throw and must only report `true` when a copy really
 * happened — the copy buttons show "Couldn't copy" on `false` instead of the
 * old silent no-op. `openExternal` must never fall back to `_blank` inside the
 * native shell when the in-app browser plugin is there (N3: typed
 * `@capacitor/browser`), and never throw when it is not.
 */
import '@testing-library/jest-dom';
import type { JSX } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { t } from '@/lib/i18n';
import { ExternalLink, copyStateLabel, copyText, openExternal, useCopyText } from './kit';

const browserOpen = vi.hoisted(() => vi.fn());
vi.mock('@capacitor/browser', () => ({ Browser: { open: browserOpen } }));

const origClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

function setExecCommand(impl: ((cmd: string) => boolean) | undefined): void {
  Object.defineProperty(document, 'execCommand', { value: impl, configurable: true, writable: true });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  browserOpen.mockReset();
  if (origClipboard) Object.defineProperty(navigator, 'clipboard', origClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  delete (document as { execCommand?: unknown }).execCommand;
  delete (window as { Capacitor?: unknown }).Capacitor;
});

describe('copyText', () => {
  it('resolves true and writes via the Clipboard API when it works', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyText('https://x.test/e/abc')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://x.test/e/abc');
  });

  it('falls back to execCommand when the Clipboard API is absent', async () => {
    setClipboard(undefined);
    const exec = vi.fn().mockReturnValue(true);
    setExecCommand(exec);
    await expect(copyText('hello')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    // The temporary textarea is always cleaned up.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('resolves false (never throws) when the Clipboard API is absent and no fallback works', async () => {
    setClipboard(undefined);
    setExecCommand(undefined);
    await expect(copyText('hello')).resolves.toBe(false);
  });

  it('resolves false when writeText rejects and the fallback also fails', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    setExecCommand(vi.fn().mockReturnValue(false));
    await expect(copyText('hello')).resolves.toBe(false);
  });

  it('resolves false when the fallback itself throws', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('blocked')) });
    setExecCommand(() => {
      throw new Error('SecurityError');
    });
    await expect(copyText('hello')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});

function CopyProbe({ text }: { text: string }): JSX.Element {
  const [state, copy] = useCopyText(1000);
  return (
    <button type="button" onClick={() => void copy(text)}>
      {copyStateLabel(state, 'Copy link', 'Copied!')}
    </button>
  );
}

describe('useCopyText + copyStateLabel', () => {
  it('shows "Copied!" on success, then reverts', async () => {
    vi.useFakeTimers();
    try {
      setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
      render(<CopyProbe text="x" />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button'));
      });
      expect(screen.getByRole('button')).toHaveTextContent('Copied!');
      act(() => {
        vi.advanceTimersByTime(1001);
      });
      expect(screen.getByRole('button')).toHaveTextContent('Copy link');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the visible failure label when the copy fails', async () => {
    setClipboard(undefined);
    setExecCommand(undefined);
    render(<CopyProbe text="x" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByRole('button')).toHaveTextContent(t.shared.kit.copyFailed);
  });
});

describe('openExternal', () => {
  it('opens a new tab with noopener,noreferrer in the browser', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('https://plus-one.io/terms');
    expect(open).toHaveBeenCalledWith('https://plus-one.io/terms', '_blank', 'noopener,noreferrer');
  });

  it('uses @capacitor/browser (Custom Tabs / SFSafariViewController) inside the native shell, not window.open', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    browserOpen.mockResolvedValue(undefined);
    (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    openExternal('https://plus-one.io/privacy');
    await vi.waitFor(() => expect(browserOpen).toHaveBeenCalledWith({ url: 'https://plus-one.io/privacy' }));
    expect(open).not.toHaveBeenCalled();
  });

  it('never throws and falls back to window.open when the native plugin refuses', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    browserOpen.mockRejectedValue(new Error('plugin not implemented'));
    (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    expect(() => openExternal('https://plus-one.io/terms')).not.toThrow();
    await vi.waitFor(() =>
      expect(open).toHaveBeenCalledWith('https://plus-one.io/terms', '_blank', 'noopener,noreferrer'),
    );
  });

  it('does not touch the native plugin in a normal browser', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('https://plus-one.io/terms');
    expect(browserOpen).not.toHaveBeenCalled();
  });
});

describe('ExternalLink', () => {
  it('keeps href, never sets target=_blank, and routes a plain click through openExternal', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<ExternalLink href="https://plus-one.io/terms">Terms</ExternalLink>);
    const link = screen.getByRole('link', { name: 'Terms' });
    expect(link).toHaveAttribute('href', 'https://plus-one.io/terms');
    expect(link).not.toHaveAttribute('target');
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith('https://plus-one.io/terms', '_blank', 'noopener,noreferrer');
  });

  it('leaves modified clicks (cmd/ctrl) to the browser', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    // jsdom can't navigate; swallow the default action after React has run.
    const stop = (e: Event): void => e.preventDefault();
    window.addEventListener('click', stop);
    try {
      render(<ExternalLink href="https://plus-one.io/terms">Terms</ExternalLink>);
      fireEvent.click(screen.getByRole('link', { name: 'Terms' }), { metaKey: true });
      expect(open).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('click', stop);
    }
  });
});
