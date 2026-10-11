// The mail types the Platform > Mail log screen offers, client-safe (no
// server-only imports): the filter and the "Send a test mail" picker
// (z8uq9m49k1). test-mails.test.ts checks that TEST groups match exactly what
// the server can render (TEST_MAIL_GROUPS in test-mails.ts).

export const MAIL_TYPE_GROUPS = {
  guest: [
    'guest_on_list',
    'guest_plus_ones',
    'guest_event_changed',
    'guest_event_canceled',
    'guest_removed',
    'guest_reminder',
    'guest_request_approved',
    'guest_request_partly',
    'guest_request_declined',
  ],
  team: ['team_request', 'team_quota', 'team_decision', 'team_digest'],
  invite: [
    'team_join',
    'team_added_to_event',
    'team_resend',
    'team_invite_declined',
    'team_invite_declined_confirm',
    'platform_invite',
  ],
  billing: [
    'billing_trial_day0',
    'billing_trial_day7',
    'billing_trial_day12',
    'billing_trial_ended',
    'billing_trial_day21',
    'billing_payment_failed',
    'billing_canceled',
  ],
} as const;

/** Logged but never testable: Supabase's own invite and the Edge Function digest. */
export const LOG_ONLY_MAIL_TYPES = ['auth_invite', 'platform_digest'] as const;

export const MAIL_LOG_STATUSES = ['queued', 'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed'] as const;
