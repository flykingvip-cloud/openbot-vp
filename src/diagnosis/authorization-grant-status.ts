/**
 * Shared grant-status vocabulary for diagnosis authorization + visualization.
 * Keep this file isomorphic: UI visualization must not pull Phase 7 delegation
 * (diagnosers → diagnose → snapshot persist / child_process).
 */
export const AUTHORIZATION_GRANT_STATUSES = [
  "REQUESTED",
  "APPROVED",
  "DENIED",
  "EXPIRED",
  "REVOKED",
  "CONSUMED",
  "SUSPENDED",
] as const;
export type AuthorizationGrantStatus = (typeof AUTHORIZATION_GRANT_STATUSES)[number];
