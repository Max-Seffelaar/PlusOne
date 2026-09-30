// Push transport vocabulary shared by the providers and push-client (Fase 17 N5).
// Its own module so `provider.ts` ↔ `capacitor-provider.ts` share values
// without an import cycle.
import type { Database } from '@/lib/database.types';

/** The `push_tokens.transport` check constraint (N2, 20260925120000), as values.
 *  The generated types only say `string`; a unit test pins this list to the SQL. */
export const PUSH_TRANSPORTS = ['web-push', 'fcm', 'apns'] as const;
export type PushTransport = (typeof PUSH_TRANSPORTS)[number] & Database['public']['Tables']['push_tokens']['Insert']['transport'];
/** Named transports, so no caller spells one as a bare string. */
export const PUSH_TRANSPORT = { webPush: 'web-push', fcm: 'fcm', apns: 'apns' } as const satisfies Record<string, PushTransport>;

/** What `push_tokens.device_label` may say: the platform, never a device or person
 *  name (column comment: no PII). FCM alone does not imply Android — iOS joins
 *  through Firebase Messaging in S1b — so the provider reports it. */
export type PushDevicePlatform = 'android' | 'ios' | 'web';
