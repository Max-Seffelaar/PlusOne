// Team notification preferences (Profile → Notifications) and the team mail
// unsubscribe page (/n/[token]). Gastcommunicatie F, PR 6b (z8uq9m2vpy).
export const notifications = {
  prefs: {
    title: 'Notifications',
    intro: 'Choose how PlusOne tells you about requests that need you.',
    requestsTitle: 'Guest list requests',
    requestsSub: 'Someone asks for a spot through a request link.',
    quotaTitle: 'Quota requests',
    quotaSub: 'A team member asks for more guest spots.',
    decisionsTitle: 'Answers to my requests',
    decisionsSub: 'An admin approves or declines your quota request.',
    push: 'Push',
    email: 'Email',
    emailImmediate: 'Right away',
    emailDaily: 'Daily',
    emailOff: 'Off',
    digestTitle: 'Daily summary',
    digestSub: 'One email at 09:00 with what is still open. Nothing when nothing is.',
    saving: 'Saving…',
    saved: 'Saved.',
    error: "Couldn't save your notification settings. Try again.",
  },
  unsubscribe: {
    pageTitle: 'PlusOne notifications',
    title: 'Stop these emails?',
    body: "You won't get this kind of email from PlusOne anymore. You can turn it back on in your profile.",
    confirm: 'Stop these emails',
    doneTitle: 'Emails stopped',
    doneBody: 'Turn them back on any time in your profile under Notifications.',
    throttled: 'Too many tries from this network. Try again in a few minutes.',
  },
} as const;
