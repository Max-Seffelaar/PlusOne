import { describe, it, expect } from 'vitest';
import { nativeBackAction } from './native-back';

const online = { canGoBack: true, online: true };

describe('nativeBackAction (Android back button, N3)', () => {
  it('minimizes on the /app root instead of going back or exiting', () => {
    expect(nativeBackAction('/app', online)).toEqual({ kind: 'minimize' });
    expect(nativeBackAction('/app/', online)).toEqual({ kind: 'minimize' });
    expect(nativeBackAction('/app', { canGoBack: false, online: false })).toEqual({ kind: 'minimize' });
  });

  it('retraces history on every other /app screen, tab and door overlay', () => {
    for (const path of ['/app/events', '/app/events/abc/edit', '/app/door', '/app/guests/g1', '/app/more']) {
      expect(nativeBackAction(path, online)).toEqual({ kind: 'history-back' });
    }
  });

  it('falls back to the /app root when a deep link has no history (never dead-ends)', () => {
    expect(nativeBackAction('/app/events/abc', { canGoBack: false, online: true })).toEqual({
      kind: 'replace',
      to: '/app',
    });
  });

  it('does not treat a lookalike prefix as the /app surface', () => {
    expect(nativeBackAction('/apply', { canGoBack: false, online: true })).toEqual({ kind: 'minimize' });
    expect(nativeBackAction('/application', online)).toEqual({ kind: 'history-back' });
  });

  it('standalone door: /door/<id> goes to the picker, the picker minimizes', () => {
    expect(nativeBackAction('/door/evt-1', online)).toEqual({ kind: 'replace', to: '/door' });
    expect(nativeBackAction('/door/evt-1', { canGoBack: false, online: true })).toEqual({ kind: 'replace', to: '/door' });
    expect(nativeBackAction('/door', online)).toEqual({ kind: 'minimize' });
  });

  it('never replaces the offline Deur tab away when there is no history (#25)', () => {
    const coldOffline = { canGoBack: false, online: false };
    expect(nativeBackAction('/app/door', coldOffline)).toEqual({ kind: 'none' });
    // pathname only — the query (?event=…&guest=…) never reaches it
    expect(nativeBackAction('/app/door/', coldOffline)).toEqual({ kind: 'none' });
    // with history, back offline is fine (router cache)
    expect(nativeBackAction('/app/door', { canGoBack: true, online: false })).toEqual({ kind: 'history-back' });
    // online, the cold-start fallback still goes to the root
    expect(nativeBackAction('/app/door', { canGoBack: false, online: true })).toEqual({ kind: 'replace', to: '/app' });
    // the guard is door-only: other screens keep the root fallback offline
    expect(nativeBackAction('/app/events/abc', coldOffline)).toEqual({ kind: 'replace', to: '/app' });
    expect(nativeBackAction('/app/doorways', coldOffline)).toEqual({ kind: 'replace', to: '/app' });
  });

  it('never leaves a working offline door for the network-only picker (#25)', () => {
    expect(nativeBackAction('/door/evt-1', { canGoBack: true, online: false })).toEqual({ kind: 'none' });
  });
});
