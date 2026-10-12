/**
 * PostHog client configuration (docs/posthog-implementation-plan.md §6–7).
 *
 * No key = nothing, ever: with `NEXT_PUBLIC_POSTHOG_KEY` empty or unset the
 * adapter stays a no-op — posthog-js is never downloaded, nothing is stored,
 * no request leaves the page. That is how this ships: built and merged without
 * a key (decision Max 2026-10-12), switched on by setting the env var after the
 * legal round. Local dev is silent by default (scripts/dev-env.mjs writes no key).
 */
import type { PostHogConfig } from 'posthog-js';
import { stripUrlProperties } from './sanitize';

/** Inlined at build time; empty string when unset. */
export const POSTHOG_KEY: string = (process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '').trim();

/** Same-origin reverse proxy (next.config.js rewrites): adblock-resilient, no CSP change, Capacitor-safe. */
export const POSTHOG_API_HOST = '/ingest';
/** PostHog Cloud EU (eu-west-1 Supabase, fra1 Vercel). Only used for links into the PostHog UI. */
export const POSTHOG_UI_HOST = 'https://eu.posthog.com';

export function analyticsConfigured(): boolean {
  return POSTHOG_KEY.length > 0;
}

/**
 * Everything automatic is OFF. The app is guest-list software: DOM text in a list
 * row is a guest's name, so autocapture, heatmaps, dead clicks, session replay and
 * pageviews (which would carry URLs) stay off; only the typed events in events.ts
 * are sent. No feature flags, surveys, tours, chat or web experiments either, and
 * no extra scripts loaded from PostHog: the one network path is event ingestion
 * through /ingest. Persistence is localStorage, never a cookie (webview-safe, #37).
 */
export function posthogConfig(): Partial<PostHogConfig> {
  return {
    api_host: POSTHOG_API_HOST,
    ui_host: POSTHOG_UI_HOST,
    persistence: 'localStorage',
    person_profiles: 'identified_only',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_exceptions: false,
    capture_performance: false,
    rageclick: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    mask_personal_data_properties: true,
    save_referrer: false,
    before_send: (event) => {
      if (!event) return event;
      event.properties = stripUrlProperties(event.properties);
      if (event.$set) event.$set = stripUrlProperties(event.$set);
      if (event.$set_once) event.$set_once = stripUrlProperties(event.$set_once);
      return event;
    },
  };
}
