export type CognitiveMergeStep =
  | "S1"
  | "S1b"
  | "S2"
  | "S3"
  | "S3_intent"
  | "S4"
  | "S5"
  | "S5c"
  | "S6"
  | "S7"
  | "S8"
  | "S9"
  | "R0"
  | "R3b"
  | "R4"
  | "R7";

export type CognitiveMergeFaultHook = {
  crashAfter?: CognitiveMergeStep;
  failStep?: CognitiveMergeStep;
  forceAbandonPostCommit?: boolean;
  failPostCommitTargetCas?: boolean;
  failRecoveryProtectedCas?: "claim" | "abandon" | "publish";
  failRecoveryRelease?: boolean;
  beforeStep?: (step: CognitiveMergeStep) => void | Promise<void>;
};

let installedHook: CognitiveMergeFaultHook | undefined;

export function getCognitiveMergeFaultHook(): CognitiveMergeFaultHook | undefined {
  return installedHook;
}

/** Test-only. Not re-exported from the production barrel. */
export function installCognitiveMergeFaultHookForTests(next?: CognitiveMergeFaultHook): void {
  installedHook = next;
}

export class CognitiveMergeCrashError extends Error {
  readonly step: CognitiveMergeStep;
  constructor(step: CognitiveMergeStep) {
    super(`cognitive_merge_crash:${step}`);
    this.step = step;
  }
}

export async function beginMergeStep(step: CognitiveMergeStep): Promise<void> {
  const hook = installedHook;
  if (!hook) {
    return;
  }
  await hook.beforeStep?.(step);
  if (hook.failStep === step) {
    throw new Error(`cognitive_merge_fault:${step}`);
  }
}

export async function endMergeStep(step: CognitiveMergeStep): Promise<void> {
  const hook = installedHook;
  if (hook?.crashAfter === step) {
    throw new CognitiveMergeCrashError(step);
  }
}
