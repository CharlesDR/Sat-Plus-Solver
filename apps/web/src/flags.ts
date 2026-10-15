/**
 * Feature flags (F3): every switch that hides a built feature, in one place.
 * Each says what it hides and when it comes back. Flags are compile-time
 * constants, so a hidden feature's code is tree-shaken from the build.
 */

/**
 * Link transport (kind, tier, belt or pipe count) is a Phase 2 feature: the
 * link editor and the Links table hide it, and new links don't write it.
 * Saved values are kept. Phase 2 turns this back on.
 */
export const SHOW_TRANSPORT = false;
