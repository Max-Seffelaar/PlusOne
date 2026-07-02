/**
 * Auth + MFA surface copy (Welcome → Login → OTP → MFA, plus Invite; #20).
 *
 * Dial = low wink: calm, clear, trustworthy around login and security. Welcome
 * may carry a little personality. Strings from copy-deck.md §10 are used verbatim;
 * the wireframe-only extras (anti-enumeration note, resend timer, MFA-mandatory
 * note, invite role/slots detail) follow tone-of-voice.md — sentence case,
 * numerals, no em-dash habit, glossary terms exact (PlusOne, Admin, Finance,
 * Host, Quota, Audit log, Venue).
 *
 * Composed into the central dictionary (`../en.ts`) — components read these as
 * `t.auth.<key>` and fill {placeholders} with `fmt`.
 */
export const auth = {
  // ── Shared ───────────────────────────────────────────────────────────────
  backAria: 'Back',
  verify: 'Verify',

  // ── Welcome ──────────────────────────────────────────────────────────────
  welcomeTitle: 'Welcome to PlusOne',
  welcomeSub: 'The guest list that runs the door.',
  welcomeLogin: 'Log in',
  welcomeHasInvite: 'I have an invite',

  // ── Login ────────────────────────────────────────────────────────────────
  loginTitle: 'Log in',
  loginHelp: "We'll email you a 6-digit code. No passwords here.",
  loginEmailLabel: 'Email',
  loginEmailPlaceholder: 'you@venue.com',
  loginSend: 'Send code',
  loginNote: "Invite-only accounts. If your address isn't on file, we won't say so on purpose. It stops enumeration.",

  // ── OTP ──────────────────────────────────────────────────────────────────
  otpTitle: 'Enter your code',
  otpSentTo: 'We sent a 6-digit code to {email}.',
  // Split for the styled email span: "<lead> {email}<trail>"
  otpSentLead: 'We sent a 6-digit code to ',
  otpSentTrail: '.',
  otpEmailFallback: 'you@venue.com',
  otpVerify: 'Verify',
  otpResend: 'Resend code ({time})',

  // ── MFA (step-up) ────────────────────────────────────────────────────────
  mfaTitle: "Verify it's you",
  mfaRolePre: "You're ",
  mfaRoleBold: 'Admin',
  mfaRolePost: '. Enter the code from your authenticator app.',
  mfaCodePlaceholder: '6-digit code',
  mfaLogIn: 'Log in',
  mfaNote: 'MFA is required for Admin and Finance. Quota grants, role changes, and the audit log need this step (AAL2).',

  // ── Invite ───────────────────────────────────────────────────────────────
  inviteLabel: 'Invite',
  inviteTitle: '{inviter} invited you to {venue}.',
  invitePre: 'You get the ',
  inviteRoleBold: 'Host',
  inviteMid: ' role with ',
  inviteSlotsBold: '5 guest list spots',
  invitePost: ' per event. Your account works independently of the venue. Access elsewhere stays yours.',
  inviteSlotsChip: '5 spots/event',
  inviteAccept: 'Accept invite',
  inviteNotNow: 'Not now',

  // ── Consent (first-login Terms + Privacy gate, #20/#40) ───────────────────
  consentBadge: 'Quick thing',
  consentTitle: 'Terms & privacy',
  consentBody: 'Before you continue, please agree to our terms and privacy policy.',
  // Account-setup variant (T1 #3): a first-time user also fills in their name
  // (required) + phone (optional, encouraged) on this same screen — one flow.
  accountBadge: 'Almost in',
  accountTitle: 'Create your account',
  accountBody: 'Tell us who you are. Your name shows up for your team and at the door.',
  accountFirstName: 'First name',
  accountLastName: 'Last name',
  accountPhone: 'Phone',
  accountPhoneNote: 'Optional, but handy so your team can reach you on event night.',
  accountSubmit: 'Create account',
  consentSignedInAs: 'Signed in as {email}.',
  // Split so the Terms/Privacy words can be links.
  consentPre: 'I agree to the ',
  consentTerms: 'Terms',
  consentMid: ' and ',
  consentPrivacy: 'Privacy Policy',
  consentPost: '.',
  consentSubmit: 'Agree & continue',
  consentBusy: 'Working…',
  consentError: 'Something went wrong.',
} as const;
