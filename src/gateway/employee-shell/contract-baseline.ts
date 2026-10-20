/**
 * Tri-Platform Employee Shell — frozen v1 gateway contract (Phase 1).
 *
 * The tri-platform unification plan (docs/design/tri-platform-unification-2026-07-05.md)
 * reuses the EXISTING gateway read-models as the employee-shell v1 contract
 * instead of inventing a new `daily-overview:*` / `workspace:*` namespace. This
 * module pins that decision: the colocated test asserts every method below is
 * still registered (and that the personal workbench surfaces stay actor-scoped),
 * so a rename/removal that would break the native + web employee shells fails
 * loudly at test time rather than silently at runtime.
 *
 * Only methods verified present in `listGatewayMethods()` are frozen here.
 */

/**
 * Personal workbench read-model = overview / daily-signal cards. Every handler
 * resolves the actor via `resolveEmployeeWorkbenchActor()` (trusted user.id),
 * so these MUST remain self-scoped (never the unscoped, install-wide view).
 */
export const EMPLOYEE_SHELL_WORKBENCH_V1_METHODS = [
  "workbench.pending-tasks.list",
  "workbench.my-tasks.list",
  "workbench.notices.list",
  "workbench.upcoming-collaboration.list",
  "workbench.schedule.list",
  "workbench.steward-suggestion.get",
] as const;

/** Collaboration / spaces surface reused by the employee shell. */
export const EMPLOYEE_SHELL_COLLABORATION_V1_METHODS = ["collaboration.spaces.list"] as const;

/** Knowledge workspace read-model reused by the employee shell. */
export const EMPLOYEE_SHELL_KNOWLEDGE_V1_METHODS = [
  "knowledge.base.list",
  "knowledge.base.get",
  "knowledge.base.documents.list",
  "knowledge.base.snippets.list",
] as const;

/** The full frozen v1 employee-shell RPC surface. */
export const EMPLOYEE_SHELL_V1_METHODS = [
  ...EMPLOYEE_SHELL_WORKBENCH_V1_METHODS,
  ...EMPLOYEE_SHELL_COLLABORATION_V1_METHODS,
  ...EMPLOYEE_SHELL_KNOWLEDGE_V1_METHODS,
] as const;

export type EmployeeShellV1Method = (typeof EMPLOYEE_SHELL_V1_METHODS)[number];

/**
 * Assistant / session methods the design doc §3.2 lists as reusable but which
 * are NOT part of the static gateway method registry (`listGatewayMethods()`).
 * They are recorded here (not frozen) so a follow-up can confirm their
 * registration path and promote them into `EMPLOYEE_SHELL_V1_METHODS` — until
 * then the freeze test intentionally does not assert their registration.
 */
export const EMPLOYEE_SHELL_DEFERRED_METHODS = [
  "sessions.list",
  "sessions.patch",
  "agents.list",
] as const;
