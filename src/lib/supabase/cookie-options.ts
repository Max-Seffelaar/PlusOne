// "Remember me" window for the Supabase auth session cookies.
//
// Once a user has completed e-mail OTP + (for admin/finance) MFA, the session
// should persist across browser restarts so they are not forced to log in again
// constantly — otherwise users complain (ClickUp "30 dagen onthouden").
//
// This only extends the *cookie* lifetime (so the refresh token survives a
// browser restart for 30 days). The access token JWT stays short-lived and is
// rotated on refresh — decision #20 (short-lived access tokens, refresh rotation
// on) is preserved. AAL2 is encoded in the session, so a returning user within
// the window keeps their MFA assurance without re-challenging.
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds
