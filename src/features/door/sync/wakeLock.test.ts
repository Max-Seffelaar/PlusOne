// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isWakeLockSupported,
  readWakeLockOffPreference,
  releaseWakeLock,
  requestScreenWakeLock,
  writeWakeLockOffPreference,
  type WakeLockSentinelLike,
} from './wakeLock';

function stubWakeLock(request: ((type: 'screen') => Promise<WakeLockSentinelLike>) | undefined): void {
  if (request) {
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  } else {
    Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true });
  }
}

function fakeSentinel(): WakeLockSentinelLike {
  let released = false;
  return {
    get released() {
      return released;
    },
    release: vi.fn(async () => {
      released = true;
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

describe('isWakeLockSupported', () => {
  afterEach(() => stubWakeLock(undefined));

  it('is false when navigator.wakeLock is absent (most webviews, older browsers)', () => {
    stubWakeLock(undefined);
    expect(isWakeLockSupported()).toBe(false);
  });

  it('is true when navigator.wakeLock.request exists', () => {
    stubWakeLock(async () => fakeSentinel());
    expect(isWakeLockSupported()).toBe(true);
  });
});

describe('requestScreenWakeLock', () => {
  afterEach(() => stubWakeLock(undefined));

  it('resolves null without calling the API when unsupported', async () => {
    stubWakeLock(undefined);
    await expect(requestScreenWakeLock()).resolves.toBeNull();
  });

  it('resolves the sentinel on a successful request', async () => {
    const sentinel = fakeSentinel();
    stubWakeLock(async () => sentinel);
    await expect(requestScreenWakeLock()).resolves.toBe(sentinel);
  });

  it('resolves null (never throws) when the platform rejects the request', async () => {
    stubWakeLock(async () => {
      throw new DOMException('document not visible', 'NotAllowedError');
    });
    await expect(requestScreenWakeLock()).resolves.toBeNull();
  });
});

describe('releaseWakeLock', () => {
  it('no-ops on null', async () => {
    await expect(releaseWakeLock(null)).resolves.toBeUndefined();
  });

  it('no-ops on an already-released sentinel (does not call release again)', async () => {
    const sentinel = fakeSentinel();
    await sentinel.release();
    await releaseWakeLock(sentinel);
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('calls release on an active sentinel', async () => {
    const sentinel = fakeSentinel();
    await releaseWakeLock(sentinel);
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected release call', async () => {
    const sentinel: WakeLockSentinelLike = {
      released: false,
      release: vi.fn(async () => {
        throw new Error('boom');
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    await expect(releaseWakeLock(sentinel)).resolves.toBeUndefined();
  });
});

describe('wake-lock off preference (86ey6x56p review — explicit OFF must survive a reload)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to false (on) when nothing is persisted', () => {
    expect(readWakeLockOffPreference()).toBe(false);
  });

  it('round-trips true/false through localStorage', () => {
    writeWakeLockOffPreference(true);
    expect(readWakeLockOffPreference()).toBe(true);
    writeWakeLockOffPreference(false);
    expect(readWakeLockOffPreference()).toBe(false);
  });

  it('never throws when localStorage is unavailable (private mode, blocked storage)', () => {
    const getItemSpy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(readWakeLockOffPreference()).toBe(false);
      expect(() => writeWakeLockOffPreference(true)).not.toThrow();
    } finally {
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    }
  });
});
