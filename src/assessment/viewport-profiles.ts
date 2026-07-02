/**
 * viewport-profiles.ts — device emulation presets for multi-viewport audits.
 *
 * These settings are applied at Playwright *context creation* (isMobile,
 * deviceScaleFactor and hasTouch cannot change afterwards), which is why a run
 * targets a single profile and the service loops profiles for desktop+mobile.
 */

import type { ViewportProfile } from './types.js';

export interface ViewportProfileSpec {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent?: string;
}

export const VIEWPORT_PROFILES: Record<ViewportProfile, ViewportProfileSpec> = {
  desktop: {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  mobile: {
    // iPhone 13/14-class logical viewport.
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
};

export function getViewportProfileSpec(profile: ViewportProfile): ViewportProfileSpec {
  return VIEWPORT_PROFILES[profile] ?? VIEWPORT_PROFILES.desktop;
}
