import type { BlockerGrade, EnvProbe } from "./blocker.js";
export type TurnCompletionState = "delivered" | "permanent_block" | "true_fork";
export type TurnCompletionContract = {
  state: TurnCompletionState;
  openablePath?: string;
  reason?: string;
  degradation?: string;
  requiredUserAction?: string;
  options?: string[];
  sidePathReceipt?: string;
};

export type WritabilityProbe = {
  path: string;
  lsMode: string;
  writeAttempt: "ok" | "eacces" | "eperm" | "erofs" | "enoent" | "not_attempted" | "error";
  sandboxPolicyCode?: string;
  /** False when the only evidence is an ls mode string, or the path is a side path. */
  hardStop: boolean;
  blockerGrade: BlockerGrade;
};

export type TurnCompletionDeliverable = {
  relativePath: string;
  body: string;
};

export type TurnCompletionInput = {
  userText?: string;
  assistantText?: string;
  workspaceDir?: string | null;
  envProbes?: readonly EnvProbe[];
  /** Wall-clock start of the skill-smoke attempt. Absent on ordinary chat. */
  smokeStartedAtMs?: number;
  nowMs?: number;
  slaMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Force the skill-smoke SLA even when the text does not say smoke. */
  skillSmoke?: boolean;
  forkOptions?: readonly string[];
  openablePaths?: readonly string[];
  /** Evidence from an already attempted secondary write; settlement never executes it. */
  sidePathFailure?: { label: string; reason: string; code?: string };
  deliverable?: TurnCompletionDeliverable;
  sessionKey?: string;
  /**
   * Batch 11 E3. When true, do not settle this turn to delivered or
   * permanent_block. Omit or false preserves the existing settlement.
   * The default-off OGUI lifecycle never sets this.
   */
  oguiWaitActive?: boolean;
};

export type TurnCompletionHardStop = "empty_success" | "side_path_refusal";

export type TurnCompletionSettlement = {
  contract: TurnCompletionContract | null;
  visibleText: string;
  continueExecution: boolean;
  hardStopPrevented: TurnCompletionHardStop | null;
};
