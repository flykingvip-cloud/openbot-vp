import type { AppViewState } from "./app-view-state.ts";
import type { WorkbenchKnowledgeSurface } from "./ports/employee/views/home-page-contracts.ts";

type NonFunctionPropertyNames<T> = {
  [Key in keyof T]: Extract<T[Key], (...args: never[]) => unknown> extends never ? Key : never;
}[keyof T] &
  keyof T;

type KnowledgeUniversePortBackedSurface = Pick<
  WorkbenchKnowledgeSurface,
  Exclude<
    NonFunctionPropertyNames<WorkbenchKnowledgeSurface>,
    | "actorEmail"
    | "enterpriseTenantId"
    | "homeInsightsNoticeDismissed"
    | "selectedKnowledgeBaseCanWrite"
  >
>;

type PrefixKnowledgeUniverseKeys<T extends Record<string, unknown>> = {
  [Key in keyof T as Key extends string ? `knowledgeUniverse${Capitalize<Key>}` : never]: T[Key];
};

type KnowledgeUniverseAppPortStateShape =
  PrefixKnowledgeUniverseKeys<KnowledgeUniversePortBackedSurface>;

type AppPortUpdateHost = {
  requestUpdate: () => void;
};

/**
 * Employee workbench port contract.
 *
 * The employee workbench still runs directly against the shell-owned runtime
 * state object from `app.ts`. Rebuild the transitional port type by starting
 * from the aggregate shell state, then overriding the knowledge-workbench
 * slice with a prefixed view derived from `WorkbenchKnowledgeSurface`.
 */
export type AppPortState = Omit<AppViewState, keyof KnowledgeUniverseAppPortStateShape> &
  KnowledgeUniverseAppPortStateShape &
  AppPortUpdateHost;

/**
 * Transitional employee workbench adapter.
 *
 * Runtime ownership is still centralized in `app.ts`, so the adapter simply
 * preserves object identity while exposing the richer port type used by the
 * workbench controllers and render model.
 */
export function adaptAppPortState(state: AppViewState): AppPortState {
  return state as AppPortState;
}
