/**
 * Request-links + influencers surface copy (Requests-epic F1, 86ey21vjt) — the
 * per-event link screen (funnel stats, QR, pause), the create/edit link sheet,
 * and the venue influencer roster. Voice: app-general, low-mid wink
 * (tone-of-voice.md). Sentence case, numerals, glossary terms exact (Request ·
 * Tier · heads). Strings with {placeholders} are filled via fmt().
 */
export const links = {
  // ── Request-links screen (per event) ────────────────────────────────────────
  title: 'Request links',
  loading: 'Loading links…',
  loadError: "Couldn't load the links. Try again in a moment.",
  empty: 'No links yet. Give every promoter their own and see who actually delivers.',
  noAccess: 'Only admins and organizers can manage request links.',
  readOnly: 'View only. Managing links needs admin or organizer rights.',

  /** Display name of the event's default (legacy landing) link. */
  standardName: 'Standard link',

  // Card chips.
  defaultChip: 'DEFAULT',
  autoChip: 'AUTO',
  pausedChip: 'PAUSED',
  expiredChip: 'EXPIRED',
  fullChip: 'FULL',

  // Card mini-stats + actions.
  stats: '{views} views · {requests} requests · {approved} approved',
  /** Checked-in headcount via this link (M14) — appended once the funnel loads. */
  statsIn: ' · {n} in',
  statsCap: ' · {heads}/{max}',
  copyAria: 'Copy link URL',
  qrAria: 'Show QR code',
  pauseAria: 'Pause or resume this link',
  defaultToggleHint: 'On/off for the default link lives in the event settings.',
  errPause: "Couldn't pause or resume the link.",

  // ── Link sheet (create / edit) ──────────────────────────────────────────────
  sheetCreateTitle: 'New request link',
  sheetEditTitle: 'Edit link',
  forWho: 'For who?',
  chipNew: '+ New',
  chipLabelOnly: 'Label only',
  newInfluencerPlaceholder: 'Influencer name',
  labelPlaceholder: 'Instagram bio',
  tierLabel: 'Tier',
  noFixedTier: 'No fixed tier',
  noFixedTierSub: 'You pick the tier per approval',
  tierUsedOfMax: '{used}/{max} used',
  tierNoMax: 'No max',
  noTiersYet: 'This event has no tiers yet. Auto-approve needs one — add a tier first.',
  autoApproveTitle: 'Auto-approve',
  autoApproveSub: 'Requests through this link go straight on the list — mind the capacity',
  maxHeadsLabel: 'Max heads (optional)',
  maxHeadsPlaceholder: '∞ no cap',
  expiresLabel: 'Expires (optional)',
  expiresDate: 'Date',
  expiresTime: 'Time',
  urlLabel: 'Link URL',
  createCta: 'Create link',
  saveCta: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  archiveCta: 'Archive link',
  archiveConfirmText: 'Archive this link? It stops taking requests; its numbers stay in the stats.',
  archiveConfirmCta: 'Yes, archive',
  archiving: 'Archiving…',
  errIdentity: 'Pick an influencer or give the link a label.',
  errNewInfluencerName: 'Enter a name for the new influencer.',
  errExpiry: 'Enter the expiry date and time, or clear both.',
  errCreate: "Couldn't create the link.",
  errSave: "Couldn't save the link.",
  errArchive: "Couldn't archive the link.",

  // ── QR sheet ────────────────────────────────────────────────────────────────
  qrTitle: 'QR code',
  qrHint: 'Point a phone at it — lands straight on the request page.',
  qrGenerating: 'Generating…',
  qrError: "Couldn't generate the QR code.",
  qrCopy: 'Copy link',
  qrCopied: 'Copied!',
  qrDownload: 'Download PNG',
  qrImageAlt: 'QR code for {url}',

  // ── Influencers screen (venue roster) ───────────────────────────────────────
  influencersTitle: 'Influencers',
  influencersLoading: 'Loading influencers…',
  influencersLoadError: "Couldn't load the influencers. Try again in a moment.",
  influencersEmpty: 'No influencers yet. Add the people who bring the crowd.',
  influencersExplainer:
    'Each influencer gets their own request links per event, so you can see exactly who delivers: views, requests, approvals.',
  influencersAdminOnly: 'Only admins can manage influencers.',
  linksCountOne: '{n} link',
  linksCountMany: '{n} links',
  addInfluencerTitle: 'New influencer',
  editInfluencerTitle: 'Edit influencer',
  nameLabel: 'Name',
  namePlaceholder: 'e.g. Jayden',
  handleLabel: 'Handle (optional)',
  handlePlaceholder: '@handle',
  notesLabel: 'Notes (optional)',
  notesPlaceholder: 'Deal, contact, vibe…',
  addCta: 'Add influencer',
  errInfluencerName: 'Enter a name.',
  errInfluencerSave: "Couldn't save the influencer.",
  archiveInfluencerCta: 'Archive influencer',
  archiveInfluencerConfirmText:
    'Archive {name}? Their links keep working; they just leave this list.',
  archiveInfluencerConfirmCta: 'Yes, archive',

  // ── Stats link block (F2 — the influencer's private /i/[token] page) ────────
  statsLinkLabel: 'Stats link',
  statsLinkExplainer:
    'Their private stats page — every view, request and check-in from their links.',
  statsLinkCreate: 'Create stats link',
  statsLinkRenew: 'Renew link',
  statsLinkActive: 'Stats link is live. Renewing replaces it; the old URL stops working.',
  statsLinkNone: 'No stats link yet.',
  statsLinkWarning: "Copy it now — it won't be shown again.",
  statsLinkCopy: 'Copy',
  statsLinkCopied: 'Copied!',
  statsLinkWorking: 'One moment…',
  statsLinkRevoke: 'Revoke',
  statsLinkRevokeConfirmText:
    'Revoke the stats link? Their page goes dead immediately; you can always create a new one.',
  statsLinkRevokeConfirmCta: 'Yes, revoke',
  statsLinkRevoked: 'Stats link revoked.',
  errStatsLink: "Couldn't update the stats link.",
} as const;
