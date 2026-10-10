// Team notification preferences (Gastcommunicatie F, PR 6b, z8uq9m2vpy). One
// shape for the form, the action and the adapter; the database CHECK on
// user_notification_prefs enforces the same (20261013180600).

import { z } from 'zod';

export const EMAIL_MODES = ['immediate', 'daily', 'off'] as const;
export type EmailMode = (typeof EMAIL_MODES)[number];

export const notificationPrefsSchema = z
  .object({
    requests: z.object({ push: z.boolean(), email: z.enum(EMAIL_MODES) }).strict(),
    quota: z.object({ push: z.boolean(), email: z.enum(EMAIL_MODES) }).strict(),
    decisions: z.object({ push: z.boolean(), email: z.boolean() }).strict(),
    digest: z.boolean(),
  })
  .strict();
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

/** Push on, email right away, decision mail on, daily summary on. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  requests: { push: true, email: 'immediate' },
  quota: { push: true, email: 'immediate' },
  decisions: { push: true, email: true },
  digest: true,
};

/** The RPC's answer -> prefs; anything off-shape falls back to the defaults. */
export function toNotificationPrefs(raw: unknown): NotificationPrefs {
  const parsed = notificationPrefsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_NOTIFICATION_PREFS;
}
