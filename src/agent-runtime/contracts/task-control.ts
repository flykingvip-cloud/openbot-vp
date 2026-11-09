/** Explicit owner controls; ordinary conversation cannot create a control request here.
 * Distinct from task-stop.ts (TaskStopScope / TaskStopRecord stop facts).
 */
export type ExplicitTaskControl =
  | { scope: "current"; action: "pause" | "cancel" }
  | { scope: "parked"; action: "resume" | "pause" | "cancel"; taskId: string };
