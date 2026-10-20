/**
 * Orchestration Plane — dispatch entry (P4.5 + Gate C shadow-observe).
 *
 * Wired into chat.send via `observeOrchestrationConsider` (P4.5b choke-point).
 * That hook copies `observeInboundTurnShadow`: synchronous, try/catch, never
 * await browser/`system.run`, never throw into the reply path. Flags default
 * OFF. Live invoke remains frozen (`ORCHESTRATION_LIVE_INVOKE === false`).
 *
 * Gate C: when `shadowEnabled && !dispatchEnabled`, `routeStep` is scored and
 * reason codes are recorded even if the allowlist is empty and CTR activation
 * is OFF. enqueue / invoke / invokedTool / wroteLedger stay false.
 *
 * DISPATCH / NODE / BROWSER / LIVE_INVOKE still fail-closed (no invoke).
 * P4.5 never materializes jobs, never invokes tools, never opens the CTR Task
 * store, never calls runActivationGate, never writes the Progress Ledger.
 *
 * `considerReadonlyInvoke` is a separate flag-gated path. It does not read
 * `ORCHESTRATION_LIVE_INVOKE` and does not change `considerDispatch`.
 */

import { debuglog } from "node:util";
import type { SkillSnapshot } from "../agents/skills/types.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  isConversationTaskActivationEnabled,
  isDispatchPermitted,
  isOrchestrationDormant,
  isReadonlyInvokeEnabled,
} from "./feature.js";
import type { ReadonlyInvokeDeps } from "./readonly-invoke.js";
import { ORCH_REASON, type OrchReasonCode } from "./reason-codes.js";
import { bindSurfaceTools, type SurfaceToolBinding } from "./surface-binding.js";
import { routeStep } from "./surface-router.js";
import {
  ORCHESTRATION_LIVE_INVOKE,
  type ExecutionSurface,
  type NodeInventory,
  type OrchestrationFlags,
  type OrchestratorJob,
  type PathKind,
  type RouteStepInput,
  type StepIntent,
  type SurfaceDecision,
} from "./types.js";

const debugOrchShadow = debuglog("openbot:orch-shadow");

export type OrchShadowObservation = {
  kind: SurfaceDecision["kind"];
  surface?: SurfaceDecision["surface"];
  reasonCodes: readonly OrchReasonCode[];
  readonly invoke: false;
  readonly enqueue: false;
};

let lastShadowObservation: OrchShadowObservation | null = null;

/** Last Gate C shadow observation (reason codes only; no identity / user text). */
export function getLastOrchShadowObservation(): OrchShadowObservation | null {
  return lastShadowObservation;
}

export function resetOrchShadowObservation(): void {
  lastShadowObservation = null;
}

function livePathWouldInvoke(flags: OrchestrationFlags): boolean {
  return (
    ORCHESTRATION_LIVE_INVOKE || flags.dispatchEnabled || flags.nodeEnabled || flags.browserEnabled
  );
}

function logShadowObservation(decision: SurfaceDecision): OrchShadowObservation {
  const observation: OrchShadowObservation = {
    kind: decision.kind,
    surface: decision.surface,
    reasonCodes: decision.reasonCodes,
    invoke: false,
    enqueue: false,
  };
  lastShadowObservation = observation;
  debugOrchShadow(
    "kind=%s surface=%s reasons=%s invoke=false enqueue=false",
    decision.kind,
    decision.surface ?? "-",
    decision.reasonCodes.join(","),
  );
  return observation;
}

export type DispatchInput = RouteStepInput & {
  /** CTR activation flag. Orchestration cannot outrun CTR. */
  ctrActivationEnabled: boolean;
  /**
   * Empty/missing allowlist fail-closed. Omit or true ⇒ no-op.
   * P4.5 does not read the CTR config store; callers must pass the proof.
   */
  allowlistEmpty?: boolean;
  /** Server-derived identity (P4.5c). Unused for invoke while allowlist is empty. */
  tenantId?: string | null;
  requesterId?: string | null;
  conversationId?: string | null;
  messageId?: string;
};

export type DispatchResult = {
  decision: SurfaceDecision;
  job: OrchestratorJob | null;
  readonly createdConversationTask: false;
  readonly invokedTool: false;
  readonly wroteLedger: false;
  /**
   * Observation-only symbol bindings for grayscale surfaces.
   * Empty when dormant / fail-closed / non-grayscale / shadow-observe.
   * Never executed.
   */
  surfaceBindings: readonly SurfaceToolBinding[];
  /** Gate C: true when routeStep was scored under shadow-only (no invoke). */
  readonly shadowObserved: boolean;
  /** Reason codes actually logged on the shadow-observe path. */
  loggedReasonCodes: readonly OrchReasonCode[];
  /** Echoed identity. Never used to invoke in this slice. */
  tenantId: string | null;
  requesterId: string | null;
  conversationId: string | null;
  messageId: string;
};

function identityOf(
  input?: Pick<DispatchInput, "tenantId" | "requesterId" | "conversationId" | "messageId">,
) {
  return {
    tenantId: input?.tenantId ?? null,
    requesterId: input?.requesterId ?? null,
    conversationId: input?.conversationId ?? null,
    messageId: input?.messageId ?? "",
  };
}

function closed(
  reasonCodes: readonly OrchReasonCode[],
  kind: SurfaceDecision["kind"] = "noop",
  input?: Pick<DispatchInput, "tenantId" | "requesterId" | "conversationId" | "messageId">,
): DispatchResult {
  return {
    decision: { kind, reasonCodes, enqueue: false, invoke: false },
    job: null,
    createdConversationTask: false,
    invokedTool: false,
    wroteLedger: false,
    surfaceBindings: [],
    shadowObserved: false,
    loggedReasonCodes: [],
    ...identityOf(input),
  };
}

/**
 * Evaluate orchestration gates and return a typed no-op.
 * Never throws (fail-closed) so a future fire-and-forget hook cannot break chat.
 */
export function considerDispatch(input: DispatchInput): DispatchResult {
  try {
    const flags: OrchestrationFlags = input.flags;
    const allowlistEmpty = input.allowlistEmpty !== false;

    if (isOrchestrationDormant(flags)) {
      return closed([ORCH_REASON.DORMANT, ORCH_REASON.NO_INVOKE_WHEN_DORMANT], "noop", input);
    }

    // LIVE_INVOKE is frozen false. If it were ever true, refuse the whole path.
    if (ORCHESTRATION_LIVE_INVOKE) {
      return closed([ORCH_REASON.FAIL_CLOSED, ORCH_REASON.LIVE_PATH_ARMED], "noop", input);
    }

    const shadowObserveOnly = flags.shadowEnabled && !flags.dispatchEnabled;

    // Gate C: score + log under shadow-only even when allowlist is empty and
    // CTR activation is OFF. Never enqueue or invoke.
    if (shadowObserveOnly) {
      if (livePathWouldInvoke(flags)) {
        return closed([ORCH_REASON.LIVE_PATH_ARMED], "noop", input);
      }
      const decision = routeStep(input);
      const observed: SurfaceDecision = {
        ...decision,
        reasonCodes: [...decision.reasonCodes, ORCH_REASON.SHADOW_OBSERVE],
        enqueue: false,
        invoke: false,
      };
      const logged = logShadowObservation(observed);
      return {
        decision: observed,
        job: null,
        createdConversationTask: false,
        invokedTool: false,
        wroteLedger: false,
        surfaceBindings: [],
        shadowObserved: true,
        loggedReasonCodes: logged.reasonCodes,
        ...identityOf(input),
      };
    }

    if (allowlistEmpty) {
      return closed([ORCH_REASON.ALLOWLIST_EMPTY], "noop", input);
    }
    if (!input.ctrActivationEnabled) {
      return closed(
        [ORCH_REASON.CTR_SHADOW_ONLY, ORCH_REASON.DISPATCH_REQUIRES_ACTIVATION],
        "noop",
        input,
      );
    }

    const decision = routeStep(input);
    const permitted = isDispatchPermitted(flags, {
      ctrActivationEnabled: input.ctrActivationEnabled,
      allowlistEmpty,
    });

    // P4.5: even when gates would permit enqueue, do not materialize a job and
    // do not invoke. DISPATCH / NODE / BROWSER / LIVE_INVOKE stay fail-closed.
    void permitted;
    void livePathWouldInvoke(flags);

    const surfaceBindings = decision.kind === "selected" ? bindSurfaceTools(decision.surface) : [];

    return {
      decision: { ...decision, enqueue: false, invoke: false },
      job: null,
      createdConversationTask: false,
      invokedTool: false,
      wroteLedger: false,
      surfaceBindings,
      shadowObserved: false,
      loggedReasonCodes: [],
      ...identityOf(input),
    };
  } catch {
    return closed([ORCH_REASON.FAIL_CLOSED], "noop", input);
  }
}

/**
 * Env-aware helper for tests: CTR activation is read from env, never treated as
 * an orchestration enable switch.
 */
export function considerDispatchFromEnv(
  input: Omit<DispatchInput, "ctrActivationEnabled">,
  env: NodeJS.ProcessEnv = process.env,
): DispatchResult {
  return considerDispatch({
    ...input,
    ctrActivationEnabled: isConversationTaskActivationEnabled(env),
  });
}

const READONLY_ROUTE_FLAGS: OrchestrationFlags = {
  shadowEnabled: true,
  dispatchEnabled: false,
  nodeEnabled: false,
  browserEnabled: false,
};

export type ReadonlyInvokeInput = {
  intent: StepIntent;
  query?: string;
  skillId?: string;
  connectedConnectorIds?: readonly string[];
  requestedConnectorId?: string;
  requestedSurface?: ExecutionSurface;
  pathKind?: PathKind;
  nodeInventory?: NodeInventory;
  config?: OpenBotConfig;
  agentSessionKey?: string;
  workspaceDir?: string;
  agentId?: string;
  isFastTestEnv?: boolean;
  existingSkillsSnapshot?: SkillSnapshot;
  /** Defaults to process.env. Tests pass a copy so the four ORCH_* switches stay untouched. */
  env?: NodeJS.ProcessEnv;
  deps?: ReadonlyInvokeDeps;
};

export type ReadonlyInvokeResult = {
  invokedTool: boolean;
  /** True only after a read-only adapter actually ran. */
  invoke: boolean;
  kind: SurfaceDecision["kind"];
  surface?: ExecutionSurface;
  reason?: string;
  toolName?: string;
  /** Truncated adapter text. Not ProgressEvidence and not acceptance. */
  untrustedText?: string;
  /** User-prompt fragment. Empty when there is nothing to append. */
  promptAppendix: string;
  readonly wroteLedger: false;
};

function readonlyClosed(
  kind: SurfaceDecision["kind"] = "noop",
  surface?: ExecutionSurface,
  reason?: string,
): ReadonlyInvokeResult {
  return {
    invokedTool: false,
    invoke: false,
    kind,
    ...(surface ? { surface } : {}),
    ...(reason ? { reason } : {}),
    promptAppendix: "",
    wroteLedger: false,
  };
}

/**
 * Flag-gated read-only invoke. Does not enter `considerDispatch`, so a true
 * `ORCHESTRATION_LIVE_INVOKE` still fail-closes only on that other function.
 * Routing uses a local shadow-only flag copy and does not write process env.
 */
export async function considerReadonlyInvoke(
  input: ReadonlyInvokeInput,
): Promise<ReadonlyInvokeResult> {
  try {
    if (!isReadonlyInvokeEnabled(input.env ?? process.env)) {
      return readonlyClosed();
    }

    const decision = routeStep({
      intent: input.intent,
      skillId: input.skillId,
      connectedConnectorIds: input.connectedConnectorIds,
      requestedConnectorId: input.requestedConnectorId,
      requestedSurface: input.requestedSurface,
      pathKind: input.pathKind,
      nodeInventory: input.nodeInventory,
      flags: { ...READONLY_ROUTE_FLAGS },
    });
    if (decision.kind !== "selected" || !decision.surface) {
      return readonlyClosed(decision.kind, decision.surface);
    }
    if (
      decision.surface !== "memory" &&
      decision.surface !== "skill" &&
      decision.surface !== "web_read" &&
      decision.surface !== "connector"
    ) {
      return readonlyClosed(decision.kind, decision.surface, "readonly_invoke_refused");
    }

    const { formatReadonlyUntrustedPrompt, invokeReadonlySurface } =
      await import("./readonly-invoke.js");
    const invoked = await invokeReadonlySurface({
      surface: decision.surface,
      query: input.query ?? "",
      skillId: input.skillId,
      config: input.config,
      agentSessionKey: input.agentSessionKey,
      workspaceDir: input.workspaceDir,
      agentId: input.agentId,
      isFastTestEnv: input.isFastTestEnv,
      existingSkillsSnapshot: input.existingSkillsSnapshot,
      deps: input.deps,
    });
    const untrustedText = invoked.untrustedText?.trim() ? invoked.untrustedText : undefined;
    return {
      invokedTool: invoked.invokedTool,
      invoke: invoked.invokedTool,
      kind: decision.kind,
      surface: decision.surface,
      ...(invoked.reason ? { reason: invoked.reason } : {}),
      ...(invoked.toolName ? { toolName: invoked.toolName } : {}),
      ...(untrustedText ? { untrustedText } : {}),
      promptAppendix: formatReadonlyUntrustedPrompt(untrustedText),
      wroteLedger: false,
    };
  } catch {
    return readonlyClosed("noop", undefined, "orch_fail_closed");
  }
}
