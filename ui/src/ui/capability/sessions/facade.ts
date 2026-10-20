import {
  deleteSession,
  deleteSessionAndRefresh,
  loadSessions,
  patchSession,
  type SessionsLoadState,
  type SessionsManageState,
} from "../../controllers/sessions.ts";

export type SessionsCapabilityLoadState = SessionsLoadState;
export type SessionsCapabilityManageState = SessionsManageState;

/**
 * Transitional capability seam for work-session operations.
 */
export const sessionsCapability = {
  delete: deleteSession,
  deleteAndRefresh: deleteSessionAndRefresh,
  load: loadSessions,
  patch: patchSession,
} as const;
