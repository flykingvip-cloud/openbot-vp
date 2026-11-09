/** Explicit owner controls; ordinary conversation cannot create a control request here.
 * Distinct from task-stop.ts (TaskStopScope / TaskStopRecord stop facts).
 */
export type ExplicitTaskControl =
  | { scope: "current"; action: "pause" | "cancel" }
  | { scope: "parked"; action: "resume" | "pause" | "cancel"; taskId: string };

export type FocusGateDecisionCode =
  | "focus_clear"
  | "focus_proceed"
  | "focus_state_unavailable"
  | "focus_switched";

export type FocusSwitchGateDecision =
  | {
      action: "continue" | "cancel_parked";
      decisionCode: Exclude<FocusGateDecisionCode, "focus_switched">;
      cutContext: false;
      taskId: string;
      statusLine?: string;
      /** Owner pause/cancel: abort in-flight via existing chat abort path. */
      abortInFlight?: boolean;
    }
  | {
      action: "auto_park" | "resume";
      decisionCode: "focus_switched";
      cutContext: true;
      taskId: string;
      currentTitle: string;
      incomingTitle: string;
      statusLine: string;
      restoredPrompt?: string;
      droppedTitle?: string;
      droppedPaths?: string[];
      abortInFlight?: boolean;
    };
