/**
 * Process-wide account-browser desk. Generic browser plan-once and SAR invoke
 * share this authority so the serial lock is the same object.
 * In-memory only. A restart boots a new epoch generation.
 */

import { getActiveAccountBrowserDesk, resetActiveAccountBrowserDeskForTests } from "./desk.js";
import { SarExecutionAuthority, memoryEpochStore } from "./execution-authority.js";

let coordinator: SarExecutionAuthority | null = null;

/**
 * Install the desk when none is active. A live SarExecutionAuthority is reused
 * and is not rebooted, so an in-flight test or run keeps its fencing token.
 */
export function ensureAccountBrowserCoordinator(): SarExecutionAuthority {
  const active = getActiveAccountBrowserDesk();
  if (active instanceof SarExecutionAuthority) {
    coordinator = active;
    return active;
  }
  if (!coordinator) {
    coordinator = new SarExecutionAuthority(memoryEpochStore());
  }
  if (!active) {
    coordinator.boot();
  }
  return coordinator;
}

export function resetAccountBrowserCoordinatorForTests(): void {
  coordinator?.dispose();
  coordinator = null;
  resetActiveAccountBrowserDeskForTests();
}
