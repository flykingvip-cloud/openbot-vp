import { createOrchLeaseStore, type OrchLeaseStore } from "./lease-store.js";
/**
 * WP-06 — Readonly multi-step pilot: memory → web_read → acceptance.
 *
 * Pure plan + injectable readonly invoke simulation for ADR naming
 * (logicalActionId / jobStepId / attempt / resultRef / lease key).
 * Does NOT flip ORCHESTRATION_LIVE_INVOKE. Does NOT write Progress Ledger.
 * Does NOT arm the live scheduler. Does NOT steal Fabric execute ownership.
 */
import {
  bindReadonlyPilotAction,
  releaseReadonlyPathBinding,
  type ReadonlyActionBinding,
} from "./path-binding.js";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";

export const READONLY_MULTISTEP_PILOT_ID = "orch.readonly.multistep.memory-web-acceptance" as const;

export type ReadonlyMultistepStepKind = "memory" | "web_read" | "acceptance";

export type ReadonlyMultistepToolIntent = "recall_memory" | "read_web";

export type ReadonlyMultistepStepPlan = {
  stepKind: ReadonlyMultistepStepKind;
  stepOrdinal: 1 | 2 | 3;
  /** Tool intent for readonly invoke; absent on acceptance. */
  intent?: ReadonlyMultistepToolIntent;
  surface?: "memory" | "web_read";
  logicalActionId: string;
  jobStepId: string;
  /** ADR lease key — same as jobStepId (production grant not claimed). */
  leaseKey: string;
  attempt: number;
};

export type ReadonlyMultistepPlan = {
  pilotId: typeof READONLY_MULTISTEP_PILOT_ID;
  taskId: string;
  tenantId: string | null;
  steps: readonly [ReadonlyMultistepStepPlan, ReadonlyMultistepStepPlan, ReadonlyMultistepStepPlan];
};

export type ReadonlyMultistepInvokeInput = {
  step: ReadonlyMultistepStepPlan;
  query: string;
};

/**
 * Minimal shape compatible with considerReadonlyInvoke / invokeReadonlySurface
 * mocks. Tests inject this; production wiring is out of scope for this pilot.
 */
export type ReadonlyMultistepInvokeResult = {
  invokedTool: boolean;
  untrustedText?: string;
  wroteLedger: false;
  surface?: string;
  toolName?: string;
  reason?: string;
  pathBinding?: ReadonlyActionBinding;
};

export type ReadonlyMultistepInvokeFn = (
  input: ReadonlyMultistepInvokeInput,
) => Promise<ReadonlyMultistepInvokeResult>;

export type ReadonlyMultistepStepResult = {
  step: ReadonlyMultistepStepPlan;
  resultRef: string | null;
  ok: boolean;
  wroteLedger: false;
  invokedTool: boolean;
  untrustedText?: string;
  reason?: string;
  pathBinding?: ReadonlyActionBinding;
  /** Present when leaseStore was used for tool steps. */
  leaseGranted?: boolean;
};

export type ReadonlyMultistepAcceptance = {
  ok: boolean;
  reason: string;
  checkedResultRefs: string[];
  wroteLedger: false;
};

export type ReadonlyMultistepPilotReport = {
  pilotId: typeof READONLY_MULTISTEP_PILOT_ID;
  taskId: string;
  liveInvokeFrozen: true;
  wroteLedger: false;
  steps: ReadonlyMultistepStepResult[];
  acceptance: ReadonlyMultistepAcceptance;
};

export function buildLogicalActionId(taskId: string, stepKind: ReadonlyMultistepStepKind): string {
  return `orch.ro.ms.${taskId.trim()}.${stepKind}`;
}

export function buildJobStepId(
  taskId: string,
  stepKind: ReadonlyMultistepStepKind,
  ordinal: 1 | 2 | 3,
): string {
  return `${taskId.trim()}::${stepKind}::${ordinal}`;
}

export function buildResultRef(jobStepId: string, attempt: number): string {
  return `orch-ro-result:${jobStepId}:a${attempt}`;
}

export function buildReadonlyMultistepPlan(input: {
  taskId: string;
  tenantId?: string | null;
  attempt?: number;
}): ReadonlyMultistepPlan {
  const taskId = input.taskId.trim();
  if (!taskId) {
    throw new Error("taskId_required");
  }
  const attempt = input.attempt ?? 1;
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("attempt_must_be_positive_integer");
  }

  const memory: ReadonlyMultistepStepPlan = {
    stepKind: "memory",
    stepOrdinal: 1,
    intent: "recall_memory",
    surface: "memory",
    logicalActionId: buildLogicalActionId(taskId, "memory"),
    jobStepId: buildJobStepId(taskId, "memory", 1),
    leaseKey: buildJobStepId(taskId, "memory", 1),
    attempt,
  };
  const webRead: ReadonlyMultistepStepPlan = {
    stepKind: "web_read",
    stepOrdinal: 2,
    intent: "read_web",
    surface: "web_read",
    logicalActionId: buildLogicalActionId(taskId, "web_read"),
    jobStepId: buildJobStepId(taskId, "web_read", 2),
    leaseKey: buildJobStepId(taskId, "web_read", 2),
    attempt,
  };
  const acceptance: ReadonlyMultistepStepPlan = {
    stepKind: "acceptance",
    stepOrdinal: 3,
    logicalActionId: buildLogicalActionId(taskId, "acceptance"),
    jobStepId: buildJobStepId(taskId, "acceptance", 3),
    leaseKey: buildJobStepId(taskId, "acceptance", 3),
    attempt,
  };

  return {
    pilotId: READONLY_MULTISTEP_PILOT_ID,
    taskId,
    tenantId: input.tenantId ?? null,
    steps: [memory, webRead, acceptance],
  };
}

/**
 * Name-level acceptance: prior tool steps must each carry a resultRef and
 * must not have written the Progress Ledger. Not a tool invoke.
 */
export function evaluateReadonlyMultistepAcceptance(input: {
  toolSteps: readonly ReadonlyMultistepStepResult[];
}): ReadonlyMultistepAcceptance {
  const checked: string[] = [];
  for (const step of input.toolSteps) {
    if (step.wroteLedger) {
      return {
        ok: false,
        reason: "ledger_write_forbidden",
        checkedResultRefs: checked,
        wroteLedger: false,
      };
    }
    if (!step.ok || !step.resultRef?.trim()) {
      return {
        ok: false,
        reason: `missing_result_ref:${step.step.stepKind}`,
        checkedResultRefs: checked,
        wroteLedger: false,
      };
    }
    if (!step.invokedTool) {
      return {
        ok: false,
        reason: `tool_not_invoked:${step.step.stepKind}`,
        checkedResultRefs: checked,
        wroteLedger: false,
      };
    }
    checked.push(step.resultRef);
  }
  if (checked.length < 2) {
    return {
      ok: false,
      reason: "acceptance_requires_memory_and_web_read",
      checkedResultRefs: checked,
      wroteLedger: false,
    };
  }
  return {
    ok: true,
    reason: "acceptance_ok",
    checkedResultRefs: checked,
    wroteLedger: false,
  };
}

export type RunReadonlyMultistepPilotInput = {
  taskId: string;
  tenantId?: string | null;
  attempt?: number;
  memoryQuery: string;
  webQuery: string;
  /** Injected readonly invoke (tests pass mocks; no network). */
  invoke: ReadonlyMultistepInvokeFn;
  /**
   * Optional in-memory (or injectable) lease store for naming drills.
   * Default: fresh in-memory store. Pass `null` to skip lease acquire/submit.
   */
  leaseStore?: OrchLeaseStore | null;
  holder?: string;
  nowMs?: number;
  /** When true (default), bind path for tool steps then release after invoke. */
  bindPath?: boolean;
};

async function runToolStep(params: {
  step: ReadonlyMultistepStepPlan;
  query: string;
  invoke: ReadonlyMultistepInvokeFn;
  leaseStore: OrchLeaseStore | null;
  holder: string;
  nowMs: number;
  bindPath: boolean;
  tenantId: string | null;
}): Promise<ReadonlyMultistepStepResult> {
  const { step, query, invoke, leaseStore, holder, nowMs, bindPath, tenantId } = params;

  let pathBinding: ReadonlyActionBinding | undefined;
  if (bindPath && step.surface) {
    const bound = bindReadonlyPilotAction({
      surface: step.surface,
      actionId: step.logicalActionId,
      correlationId: step.jobStepId,
      tenantId,
    });
    if (!bound.ok) {
      return {
        step,
        resultRef: null,
        ok: false,
        wroteLedger: false,
        invokedTool: false,
        reason: bound.reason,
      };
    }
    pathBinding = bound.binding;
  }

  let leaseFence: number | null = null;
  if (leaseStore) {
    const acquired = leaseStore.tryAcquireLease({
      jobStepId: step.leaseKey,
      holder,
      nowMs,
      attempt: step.attempt,
    });
    if (!acquired.ok) {
      if (pathBinding) {
        releaseReadonlyPathBinding(step.logicalActionId);
      }
      return {
        step,
        resultRef: null,
        ok: false,
        wroteLedger: false,
        invokedTool: false,
        reason: `lease_${acquired.reason}`,
        pathBinding,
        leaseGranted: false,
      };
    }
    leaseFence = acquired.record.fencingToken;
  }

  try {
    const invoked = await invoke({ step, query });
    if (invoked.wroteLedger) {
      return {
        step,
        resultRef: null,
        ok: false,
        wroteLedger: false,
        invokedTool: false,
        reason: "ledger_write_forbidden",
        pathBinding: invoked.pathBinding ?? pathBinding,
        leaseGranted: leaseFence !== null,
      };
    }

    const resultRef =
      invoked.invokedTool && (invoked.untrustedText?.trim() || invoked.toolName)
        ? buildResultRef(step.jobStepId, step.attempt)
        : null;

    if (leaseStore && leaseFence !== null && resultRef) {
      leaseStore.submitResult({
        jobStepId: step.leaseKey,
        holder,
        fencingToken: leaseFence,
        nowMs,
        resultRef,
      });
    }

    return {
      step,
      resultRef,
      ok: Boolean(resultRef),
      wroteLedger: false,
      invokedTool: invoked.invokedTool,
      ...(invoked.untrustedText !== undefined ? { untrustedText: invoked.untrustedText } : {}),
      ...(invoked.reason ? { reason: invoked.reason } : {}),
      pathBinding: invoked.pathBinding ?? pathBinding,
      leaseGranted: leaseFence !== null,
    };
  } finally {
    if (leaseStore && leaseFence !== null) {
      leaseStore.release({
        jobStepId: step.leaseKey,
        holder,
        fencingToken: leaseFence,
      });
    }
    if (pathBinding) {
      releaseReadonlyPathBinding(step.logicalActionId);
    }
  }
}

/**
 * Run the three-step readonly pilot. Asserts LIVE stays frozen at call time.
 */
export async function runReadonlyMultistepPilot(
  input: RunReadonlyMultistepPilotInput,
): Promise<ReadonlyMultistepPilotReport> {
  if (ORCHESTRATION_LIVE_INVOKE) {
    throw new Error("ORCHESTRATION_LIVE_INVOKE_must_remain_false");
  }

  const plan = buildReadonlyMultistepPlan({
    taskId: input.taskId,
    tenantId: input.tenantId,
    attempt: input.attempt,
  });
  const [memoryPlan, webPlan] = plan.steps;
  const leaseStore = input.leaseStore === undefined ? createOrchLeaseStore() : input.leaseStore;
  const holder = input.holder?.trim() || "readonly-multistep-pilot";
  const nowMs = input.nowMs ?? Date.now();
  const bindPath = input.bindPath !== false;

  const memoryResult = await runToolStep({
    step: memoryPlan,
    query: input.memoryQuery,
    invoke: input.invoke,
    leaseStore,
    holder,
    nowMs,
    bindPath,
    tenantId: plan.tenantId,
  });
  const webResult = await runToolStep({
    step: webPlan,
    query: input.webQuery,
    invoke: input.invoke,
    leaseStore,
    holder,
    nowMs,
    bindPath,
    tenantId: plan.tenantId,
  });

  const acceptance = evaluateReadonlyMultistepAcceptance({
    toolSteps: [memoryResult, webResult],
  });

  const acceptanceStepResult: ReadonlyMultistepStepResult = {
    step: plan.steps[2],
    resultRef: acceptance.ok
      ? buildResultRef(plan.steps[2].jobStepId, plan.steps[2].attempt)
      : null,
    ok: acceptance.ok,
    wroteLedger: false,
    invokedTool: false,
    reason: acceptance.reason,
  };

  return {
    pilotId: READONLY_MULTISTEP_PILOT_ID,
    taskId: plan.taskId,
    liveInvokeFrozen: true,
    wroteLedger: false,
    steps: [memoryResult, webResult, acceptanceStepResult],
    acceptance,
  };
}
