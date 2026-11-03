import type { IncomingTurnResult } from "../contracts/task.js";

export type CurrentTaskControlPorts = {
  /** Existing adapter must apply and persist the control atomically. */
  applyControl: (prompt: string) => IncomingTurnResult;
  abortMain: () => void;
  abortAsides: () => void;
  clearPending: () => void;
};

/** Run an already-admitted owner control; authorization and transport stay at the entrance. */
export function controlCurrentTask(
  prompt: string,
  ports: CurrentTaskControlPorts,
): IncomingTurnResult {
  const control = ports.applyControl(prompt);
  if (control.abortInFlight) {
    ports.abortMain();
    ports.abortAsides();
    ports.clearPending();
  }
  return control;
}
