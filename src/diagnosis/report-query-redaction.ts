/**
 * Shared redaction-profile vocabulary for diagnosis report query + visualization.
 * Keep this file isomorphic: UI visualization must not pull the production
 * query adapter (fs / child_process / snapshot persist).
 */
export const PRODUCTION_REDACTION_PROFILES = ["administrator", "user", "system_local"] as const;
export type ProductionRedactionProfile = (typeof PRODUCTION_REDACTION_PROFILES)[number];
