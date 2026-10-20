import type {
  AppViewAnalyticsState,
  AppViewAutomationState,
  AppViewDiagnosticsState,
  AppViewOperationsState,
  AppViewShellActionsState,
  AppViewWorkbenchState,
} from "./app-view-state-shell-slices.ts";
import type { AppViewCapabilityState } from "./capability/app-view-state-slices.ts";

/**
 * Transitional aggregate app view state.
 *
 * Runtime ownership is still centralized in `app.ts`, but the type surface is
 * now split into capability slices plus shell/workbench slices so future
 * migrations can move ownership area-by-area instead of editing one giant
 * state declaration.
 */
export type AppViewState = AppViewCapabilityState &
  AppViewWorkbenchState &
  AppViewOperationsState &
  AppViewAnalyticsState &
  AppViewAutomationState &
  AppViewDiagnosticsState &
  AppViewShellActionsState;
