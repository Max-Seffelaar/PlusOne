/**
 * Cache Storage half of the shared-device wipe (86ey9e9mn).
 *
 * `idbClearAll()` (86ey9et07) empties IndexedDB on sign-out, but the door's
 * service worker also persists *responses* in Cache Storage — origin-scoped, not
 * session-scoped — so a venue tablet handed to the next doorhost still held the
 * previous one's `/app` HTML. That HTML embeds the RSC payload: user id, venue,
 * roles, display name, memberships. Legacy Workbox caches from the retired
 * next-pwa SW are worse still (they cached Supabase REST bodies for an hour).
 *
 * Rule: on sign-out, delete EVERY cache except the PII-free offline shell
 * (`plusone-shell-*`, see public/service-worker.js). The exception is deliberate
 * — wiping the shell would cost the next doorhost their offline cold start
 * (invariant #25), and the shell contains nothing that identifies a user.
 *
 * Deny-list by prefix rather than allow-listing known cache names, so caches
 * created by anything we did not write (a stale Workbox SW, a future
 * experiment) are covered by default.
 */
const KEEP_PREFIX = 'plusone-shell-';

export async function clearDeviceCaches(): Promise<void> {
  // Webview-safe (#37): CacheStorage is absent in some embedded webviews and in
  // any non-secure context. Sign-out must never fail because of a missing API.
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => !key.startsWith(KEEP_PREFIX)).map((key) => caches.delete(key)),
    );
  } catch {
    // Best-effort: a storage error must not strand the user on the authed
    // surface — the session revoke + IndexedDB wipe are the load-bearing parts.
  }
}
