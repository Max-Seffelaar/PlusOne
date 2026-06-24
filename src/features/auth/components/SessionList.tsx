import type { SessionRow } from '@/lib/auth/sessions';
import { RevokeSessionButton } from './RevokeSessionButton';

// Best-effort human label from a user-agent string (no PII, just device hints).
function deviceLabel(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const os = /iphone|ipad|ios/i.test(ua)
    ? 'iOS'
    : /android/i.test(ua)
      ? 'Android'
      : /mac/i.test(ua)
        ? 'macOS'
        : /windows/i.test(ua)
          ? 'Windows'
          : /linux/i.test(ua)
            ? 'Linux'
            : '';
  const browser = /edg/i.test(ua)
    ? 'Edge'
    : /chrome|crios/i.test(ua)
      ? 'Chrome'
      : /firefox|fxios/i.test(ua)
        ? 'Firefox'
        : /safari/i.test(ua)
          ? 'Safari'
          : 'Browser';
  return [browser, os].filter(Boolean).join(' · ');
}

export function SessionList({
  sessions,
  admin = false,
}: {
  sessions: SessionRow[];
  admin?: boolean;
}): JSX.Element {
  if (sessions.length === 0) {
    return <p className="text-dim text-sm">No active sessions.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {sessions.map((s) => (
        <li
          key={s.sessionId}
          className="card flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="text-sm">
            <p className="flex items-center gap-2 font-semibold">
              {deviceLabel(s.userAgent)}
              {s.isCurrent && (
                <span className="bg-acc-dim text-acc-soft rounded-full px-2 py-0.5 text-xs font-semibold">
                  This device
                </span>
              )}
              {s.aal === 'aal2' && (
                <span className="border-line text-faint rounded-full border px-2 py-0.5 text-xs">
                  MFA
                </span>
              )}
            </p>
            <p className="text-faint mt-1">
              {s.ip ?? 'unknown IP'} · last active{' '}
              {new Date(s.updatedAt).toLocaleString('en-GB')}
            </p>
          </div>
          {s.isCurrent && !admin ? (
            <span className="text-faint text-xs">Current session</span>
          ) : (
            <RevokeSessionButton
              sessionId={s.sessionId}
              admin={admin}
              label={admin ? 'Log out' : 'End session'}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
