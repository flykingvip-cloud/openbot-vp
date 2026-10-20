/**
 * Browser plan-once live wiring (BROWSER_PLAN_ONCE_LEGAL_DOM_WIRE).
 * Contract: docs/design/account-computer-browser-plan-once-2026-10-08.md
 *
 * Thin adapter: observe / execute / settle against the existing shared
 * Account Computer Chromium (/snapshot + /act). No second browser stack;
 * no location.reload recovery; never auto-submit 立即支付 / payment password.
 */

import {
  AccountBrowserSerialDenied,
  claimActiveBrowserDispatch,
  releaseActiveBrowserDispatch,
} from "../site-capability/desk.js";
import { releaseStaleHumanTakeoverForAgent } from "../agents/sandbox/account-computer-stream.js";
import {
  BROWSER_PLAN_ONCE_PHASE_GATES,
  resolvePlanOncePhaseGates,
  type ResolvePlanOncePhaseGatesOpts,
} from "./browser-plan-once-phase-gates.js";
import {
  allowsChatFinal,
  createRunProgress,
  isPauseTerminal,
  prepareObserveForModel,
  runPlanOnce,
  settleConfig,
  toBrowserActBody,
  type LegalDomElement,
  type LegalDomSnapshot,
  type PlanOnceDeps,
  type PlanOnceExecuteRequest,
  type PlanOnceResult,
  type PlanOnceTerminal,
  type SettleConfig,
  type ShapeASubtask,
  type ShapeBPlan,
} from "./browser-plan-once.js";

export const BROWSER_PLAN_ONCE_LEGAL_DOM_WIRE = "BROWSER_PLAN_ONCE_LEGAL_DOM_WIRE" as const;

/** Aria node shape from browserSnapshot format=aria. */
export type BrowserAriaNodeLike = {
  ref: string;
  role: string;
  name: string;
  value?: string;
  description?: string;
  depth?: number;
};

/** Snapshot shapes already returned by src/browser/client.ts browserSnapshot. */
export type BrowserSnapshotLike =
  | {
      format: "aria";
      targetId?: string;
      url?: string;
      nodes: BrowserAriaNodeLike[];
    }
  | {
      format: "ai";
      targetId?: string;
      url?: string;
      snapshot?: string;
      refs?: Record<string, { role: string; name?: string; nth?: number }>;
    };

/**
 * Port over existing sandbox browser HTTP (/snapshot, /act). Callers inject
 * browserSnapshot + browserAct (or proxy equivalents) — never a parallel CDP stack.
 */
export type PlanOnceBrowserPort = {
  snapshot: (opts?: {
    targetId?: string;
    format?: "aria" | "ai";
    interactive?: boolean;
    refs?: "aria" | "role";
  }) => Promise<BrowserSnapshotLike>;
  act: (body: Record<string, unknown>) => Promise<unknown>;
};

export type PlanOnceWireGateInput = {
  /**
   * M1b desktop session phase. When provided, must be INTERACTIVE
   * (streamUrl / FIRST_FRAME alone never unlock automation).
   */
  sessionPhase?: string | null;
  /**
   * Interaction Ownership Coordinator phase. HUMAN_TAKEOVER cancels / blocks.
   * INTERACTIVE / BACKGROUND_AGENT / LEASE_REQUEST / GRACE / unset allow CDP path
   * (agent uses worker CDP, not stolen noVNC pointer).
   */
  ownershipPhase?: string | null;
  /** Explicit human takeover flag (UI 接管). */
  humanTakeover?: boolean;
};

export type PlanOnceWireGateResult =
  | { ok: true }
  | { ok: false; status: "BLOCKED"; reason: string };

const PRE_INTERACTIVE = new Set([
  "IDLE",
  "OPENING",
  "CONNECTING",
  "STREAM_ATTACHED",
  "FIRST_FRAME",
  "CONNECT_FAILED",
  "STREAM_STALLED",
  "AUTH_EXPIRED",
  "SESSION_LOST",
  "NETWORK_DEGRADED",
  "RECONNECTING",
  "ENDED",
]);

export type EvaluatePlanOnceWireGateOpts = PlanOnceWireGateInput & {
  /**
   * When true, missing sessionPhase / ownershipPhase → BLOCKED (production /
   * browser-tool path). Default false keeps unit / inject-deps allow.
   */
  requirePhases?: boolean;
  /** Test-only: never require missing phases (still logs via resolver when used). */
  allowMissingPhaseGates?: boolean;
  /** Pre-resolved missing reason from resolvePlanOncePhaseGates. */
  missingReason?: string;
};

/**
 * Ownership + INTERACTIVE gate for plan-once automation.
 * Missing gate fields = allow only when requirePhases is false (unit / inject-deps).
 * Production / browser-tool sets requirePhases (via resolvePlanOncePhaseGates).
 */
export function evaluatePlanOnceWireGate(
  input: EvaluatePlanOnceWireGateOpts = {},
): PlanOnceWireGateResult {
  if (input.humanTakeover === true) {
    return { ok: false, status: "BLOCKED", reason: "user 接管 / cancel" };
  }
  const ownership = (input.ownershipPhase ?? "").trim().toUpperCase();
  if (ownership === "HUMAN_TAKEOVER") {
    return { ok: false, status: "BLOCKED", reason: "user 接管 / cancel" };
  }

  const phase = (input.sessionPhase ?? "").trim().toUpperCase();
  const requirePhases = input.requirePhases === true && input.allowMissingPhaseGates !== true;
  if (requirePhases) {
    const missing: string[] = [];
    if (!phase) {
      missing.push("sessionPhase");
    }
    if (!ownership) {
      missing.push("ownershipPhase");
    }
    if (missing.length > 0) {
      return {
        ok: false,
        status: "BLOCKED",
        reason:
          input.missingReason ??
          `production plan_once requires ${missing.join(" + ")} ` +
            `(pass tool args or register setPlanOncePhaseProvider)`,
      };
    }
  }

  if (phase && PRE_INTERACTIVE.has(phase)) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: `session phase ${phase} is not INTERACTIVE (streamUrl/FIRST_FRAME ≠ ready)`,
    };
  }
  if (phase && phase !== "INTERACTIVE") {
    // Unknown non-empty phase that is not INTERACTIVE — fail closed when caller opted in.
    return {
      ok: false,
      status: "BLOCKED",
      reason: `session phase ${phase} is not INTERACTIVE`,
    };
  }
  return { ok: true };
}

/** In-flight run cancel registry (接管 cancels mid-subtask). */
const planOnceRuns = new Map<string, { cancelled: boolean }>();

export function registerPlanOnceRun(runId: string): {
  runId: string;
  cancel: () => void;
  isCancelled: () => boolean;
} {
  const id = runId.trim() || `plan-once-${Date.now()}`;
  const state = { cancelled: false };
  planOnceRuns.set(id, state);
  return {
    runId: id,
    cancel: () => {
      state.cancelled = true;
    },
    isCancelled: () => state.cancelled,
  };
}

export function cancelPlanOnceRun(runId: string): boolean {
  const state = planOnceRuns.get(runId);
  if (!state) {
    return false;
  }
  state.cancelled = true;
  return true;
}

export function clearPlanOnceRun(runId: string): void {
  planOnceRuns.delete(runId);
}

export function resetPlanOnceRunsForTests(): void {
  planOnceRuns.clear();
}

function nodeToElement(node: BrowserAriaNodeLike): LegalDomElement {
  const name = (node.name ?? "").trim();
  return {
    id: node.ref,
    role: node.role || "generic",
    name: name || undefined,
    label: name || undefined,
    value: node.value !== undefined ? String(node.value) : undefined,
    enabled: true,
    visible: true,
  };
}

function refsToElements(
  refs: Record<string, { role: string; name?: string; nth?: number }>,
): LegalDomElement[] {
  return Object.entries(refs).map(([id, ref]) => {
    const name = (ref.name ?? "").trim();
    return {
      id,
      role: ref.role || "generic",
      name: name || undefined,
      label: name || undefined,
      enabled: true,
      visible: true,
    };
  });
}

function buildSignature(parts: string[]): string {
  return parts.filter((p) => p.length > 0).join("|");
}

/** Convert existing browser snapshot → LegalDomSnapshot (re-ground every step). */
export function legalDomFromBrowserSnapshot(snap: BrowserSnapshotLike): LegalDomSnapshot {
  if (snap.format === "aria") {
    const elements = (snap.nodes ?? []).map(nodeToElement);
    const signature = buildSignature([
      snap.url ?? "",
      ...elements.map((e) => `${e.id}:${e.role}:${e.label ?? ""}:${e.value ?? ""}`),
    ]);
    return { elements, signature };
  }
  const refs = snap.refs ?? {};
  const elements = refsToElements(refs);
  const signature = buildSignature([
    snap.url ?? "",
    typeof snap.snapshot === "string" ? snap.snapshot.slice(0, 512) : "",
    ...elements.map((e) => `${e.id}:${e.role}:${e.label ?? ""}`),
  ]);
  return { elements, signature };
}

export type CreatePlanOnceDepsOpts = {
  targetId?: string;
  /** Prefer aria nodes for stable refs (default). */
  snapshotFormat?: "aria" | "ai";
  settleOverrides?: Partial<SettleConfig>;
  isCancelled?: () => boolean;
  checkVerification?: PlanOnceDeps["checkVerification"];
  /**
   * When true, settle uses act wait only (no second observe). Default false:
   * wait then re-observe for signature stability within settle_timeout_ms.
   */
  settleWaitOnly?: boolean;
  /**
   * When set (secret_inputs / allowed_risks), hosts can call observeForModel
   * for planner context. Grounding observe stays full DOM.
   */
  modelObservePlan?: {
    allowed_risks?: string[] | null;
    secret_inputs?: string[] | null;
  };
  /**
   * Account-browser scope (`account:<tenant>:<user>:browser`).
   * When set, plan start and every act re-check the shared SAR desk.
   */
  accountBrowserScopeKey?: string;
  /** Desk holder id. Defaults to the plan-once run id when the scope is set. */
  serialRunId?: string;
};

export type PlanOnceBrowserDeps = PlanOnceDeps & {
  /** Model-safe observe (risk-hide + secret redact). Undefined when no plan secrets/risks. */
  observeForModel?: () => Promise<LegalDomSnapshot>;
};

/**
 * Build PlanOnceDeps that call the existing /snapshot + /act surface.
 */
export function createPlanOnceDepsFromBrowser(
  port: PlanOnceBrowserPort,
  opts: CreatePlanOnceDepsOpts = {},
): PlanOnceBrowserDeps {
  const format = opts.snapshotFormat ?? "aria";
  const observe = async (): Promise<LegalDomSnapshot> => {
    const snap = await port.snapshot({
      targetId: opts.targetId,
      format,
      interactive: true,
      refs: format === "ai" ? "aria" : undefined,
    });
    return legalDomFromBrowserSnapshot(snap);
  };

  const modelPlan = opts.modelObservePlan;
  const needsModelObserve =
    !!modelPlan &&
    ((Array.isArray(modelPlan.secret_inputs) && modelPlan.secret_inputs.length > 0) ||
      (Array.isArray(modelPlan.allowed_risks) && modelPlan.allowed_risks.length > 0) ||
      modelPlan.secret_inputs != null ||
      modelPlan.allowed_risks != null);
  const observeForModel = needsModelObserve
    ? async (): Promise<LegalDomSnapshot> =>
        prepareObserveForModel(await observe(), modelPlan ?? {})
    : undefined;

  const execute = async (req: PlanOnceExecuteRequest): Promise<void> => {
    assertPlanOnceSerialDispatch(opts);
    const body = toBrowserActBody(req);
    if (opts.targetId) {
      body.targetId = opts.targetId;
    }
    // Never invent secrets; never auto-pay — payment clicks already blocked in runPlanOnce.
    await port.act(body);
  };

  const settle = async (cfg: SettleConfig): Promise<void> => {
    const quiet = Math.max(0, cfg.quiet_ms);
    const timeout = Math.max(quiet, cfg.settle_timeout_ms);
    const waitBody: Record<string, unknown> = {
      kind: "wait",
      timeMs: quiet,
      timeoutMs: timeout,
    };
    if (opts.targetId) {
      waitBody.targetId = opts.targetId;
    }
    try {
      await port.act(waitBody);
    } catch {
      // Wait failures must not invent recovery via location.reload — soft-sleep instead.
      await new Promise((r) => setTimeout(r, Math.min(quiet, timeout)));
    }
    if (opts.settleWaitOnly) {
      return;
    }
    // Soft DOM quiet: one extra observe; ambient-only churn is handled in runPlanOnce verify.
    try {
      await observe();
    } catch {
      // ignore observe errors during settle
    }
  };

  return {
    observe,
    execute,
    settle,
    settleOverrides: opts.settleOverrides ?? settleConfig(),
    isCancelled: opts.isCancelled,
    checkVerification: opts.checkVerification,
    observeForModel,
  };
}

export type RunPlanOnceViaBrowserOpts = CreatePlanOnceDepsOpts & {
  gate?: PlanOnceWireGateInput;
  /** Optional run id for 接管 cancel registry. */
  runId?: string;
  /**
   * Production / browser-tool: require sessionPhase + ownershipPhase after
   * auto-inject. Unit inject-deps leave false (default).
   */
  requirePhases?: boolean;
  allowMissingPhaseGates?: boolean;
  agentSessionKey?: string;
  /** Skip re-resolve when caller already ran resolvePlanOncePhaseGates. */
  resolvedGate?: ReturnType<typeof resolvePlanOncePhaseGates>;
};

export type PlanOnceWireResult = PlanOnceResult & {
  /** M2: only DONE may emit chat.final. */
  chatFinalAllowed: boolean;
  /** True when UI should pause (NEEDS_* / BLOCKED). */
  pause: boolean;
  landing: typeof BROWSER_PLAN_ONCE_LEGAL_DOM_WIRE;
  runId?: string;
  /** Phase-gates landing tag when production reminder fired. */
  phaseGatesLanding?: typeof BROWSER_PLAN_ONCE_PHASE_GATES;
  /** True when observeForModel companion was wired (secret_inputs / risks). */
  modelObserveWrapped?: boolean;
};

function decorateResult(
  result: PlanOnceResult,
  extras?: {
    runId?: string;
    phaseGatesLanding?: typeof BROWSER_PLAN_ONCE_PHASE_GATES;
    modelObserveWrapped?: boolean;
  },
): PlanOnceWireResult {
  const status = result.status;
  const terminal = status === "REPLAN" ? null : status;
  return {
    ...result,
    chatFinalAllowed: allowsChatFinal(status),
    pause: terminal ? isPauseTerminal(terminal) : false,
    landing: BROWSER_PLAN_ONCE_LEGAL_DOM_WIRE,
    runId: extras?.runId,
    phaseGatesLanding: extras?.phaseGatesLanding,
    modelObserveWrapped: extras?.modelObserveWrapped,
  };
}

/**
 * Production entry: Shape B (or A-with-steps) through existing browser port.
 */
export async function runPlanOnceViaBrowser(
  plan: ShapeBPlan | ShapeASubtask,
  port: PlanOnceBrowserPort,
  opts: RunPlanOnceViaBrowserOpts = {},
): Promise<PlanOnceWireResult> {
  const resolved =
    opts.resolvedGate ??
    resolvePlanOncePhaseGates({
      explicit: opts.gate,
      agentSessionKey: opts.agentSessionKey,
      requirePhases: opts.requirePhases === true,
      allowMissingPhaseGates: opts.allowMissingPhaseGates === true,
    } satisfies ResolvePlanOncePhaseGatesOpts);

  const gateInput: EvaluatePlanOnceWireGateOpts = {
    sessionPhase: resolved.sessionPhase,
    ownershipPhase: resolved.ownershipPhase,
    humanTakeover: resolved.humanTakeover === true || opts.gate?.humanTakeover === true,
    requirePhases: opts.requirePhases === true,
    allowMissingPhaseGates: opts.allowMissingPhaseGates === true,
    missingReason: resolved.missingReason,
  };
  const gate = evaluatePlanOnceWireGate(gateInput);
  const phaseExtras = {
    runId: opts.runId,
    phaseGatesLanding:
      resolved.omittedBeforeInject || resolved.missingRequired
        ? BROWSER_PLAN_ONCE_PHASE_GATES
        : undefined,
  };
  if (!gate.ok) {
    return decorateResult(blockedPlan(gate.reason), phaseExtras);
  }

  const serialRunId = opts.serialRunId ?? opts.runId;
  let serialHeld = false;
  if (opts.accountBrowserScopeKey) {
    try {
      assertPlanOnceSerialDispatch({
        accountBrowserScopeKey: opts.accountBrowserScopeKey,
        serialRunId,
      });
      serialHeld = true;
    } catch (err) {
      if (err instanceof AccountBrowserSerialDenied) {
        return decorateResult(blockedPlan(err.message), phaseExtras);
      }
      throw err;
    }
  }

  const registered = opts.runId ? registerPlanOnceRun(opts.runId) : null;
  const isCancelled = () => {
    if (opts.isCancelled?.()) {
      return true;
    }
    if (registered?.isCancelled()) {
      return true;
    }
    if (gateInput.humanTakeover === true) {
      return true;
    }
    if ((gateInput.ownershipPhase ?? "").toUpperCase() === "HUMAN_TAKEOVER") {
      return true;
    }
    return false;
  };

  const modelObservePlan = {
    secret_inputs: "secret_inputs" in plan ? plan.secret_inputs : undefined,
    allowed_risks: "allowed_risks" in plan ? plan.allowed_risks : undefined,
  };

  try {
    const deps = createPlanOnceDepsFromBrowser(port, {
      ...opts,
      serialRunId,
      isCancelled,
      modelObservePlan,
    });
    // observeForModel = prepareObserveForModel wrap (host/wire explicit companion;
    // grounding observe stays full DOM).
    const result = await runPlanOnce(plan, deps);
    return decorateResult(result, {
      ...phaseExtras,
      runId: registered?.runId ?? opts.runId,
      modelObserveWrapped: !!deps.observeForModel,
    });
  } catch (err) {
    if (err instanceof AccountBrowserSerialDenied) {
      return decorateResult(blockedPlan(err.message), {
        ...phaseExtras,
        runId: registered?.runId ?? opts.runId,
      });
    }
    throw err;
  } finally {
    if (serialHeld && opts.accountBrowserScopeKey) {
      releaseActiveBrowserDispatch(
        opts.accountBrowserScopeKey,
        "browser",
        serialRunId?.trim() || "plan-once",
      );
    }
    if (registered) {
      clearPlanOnceRun(registered.runId);
    }
  }
}

function blockedPlan(reason: string): PlanOnceResult {
  return {
    status: "BLOCKED",
    reason,
    progress: createRunProgress({}),
    needsFrontierReplan: false,
    allowsChatFinal: false,
    stepsCompleted: 0,
  };
}

function assertPlanOnceSerialDispatch(opts: CreatePlanOnceDepsOpts): void {
  const scopeKey = opts.accountBrowserScopeKey?.trim();
  if (!scopeKey) {
    return;
  }
  let claim = claimActiveBrowserDispatch(scopeKey, opts.serialRunId?.trim() || "plan-once");
  if (!claim.ok && claim.code === "HUMAN_TAKEOVER") {
    if (releaseStaleHumanTakeoverForAgent(scopeKey)) {
      claim = claimActiveBrowserDispatch(scopeKey, opts.serialRunId?.trim() || "plan-once");
    }
  }
  if (!claim.ok) {
    throw new AccountBrowserSerialDenied(claim.code, claim.message);
  }
}

/** Tool / chat helper: NEEDS_*, BLOCKED, FAIL, REPLAN all forbid chat.final. */
export function planOnceForbidsChatFinal(status: PlanOnceTerminal | "REPLAN"): boolean {
  return !allowsChatFinal(status);
}

/** Parse Shape B fields from a flat browser-tool params object. */
export function shapeBFromToolParams(params: Record<string, unknown>): ShapeBPlan | null {
  const stepsRaw = params.steps;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    return null;
  }
  const steps = stepsRaw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      action: (typeof s.action === "string"
        ? s.action
        : "") as ShapeBPlan["steps"][number]["action"],
      id: typeof s.id === "string" ? s.id : typeof s.ref === "string" ? s.ref : undefined,
      target: typeof s.target === "string" ? s.target : undefined,
      role: typeof s.role === "string" ? s.role : undefined,
      near: typeof s.near === "string" ? s.near : undefined,
      text: typeof s.text === "string" ? s.text : undefined,
      key: typeof s.key === "string" ? s.key : undefined,
      direction: typeof s.direction === "string" ? s.direction : undefined,
      x: typeof s.x === "number" ? s.x : undefined,
      y: typeof s.y === "number" ? s.y : undefined,
    }))
    .filter((s) => ["click", "type", "press", "scroll", "wait"].includes(s.action));

  if (steps.length === 0) {
    return null;
  }

  const inputs =
    params.inputs && typeof params.inputs === "object" && !Array.isArray(params.inputs)
      ? (params.inputs as Record<string, string>)
      : undefined;
  const verification = Array.isArray(params.verification)
    ? params.verification.filter((v): v is string => typeof v === "string")
    : undefined;
  const constraints = Array.isArray(params.constraints)
    ? params.constraints.filter((v): v is string => typeof v === "string")
    : undefined;

  return {
    finishes_task: params.finishes_task === true || params.finishesTask === true,
    summary: typeof params.summary === "string" ? params.summary : undefined,
    max_actions:
      typeof params.max_actions === "number"
        ? params.max_actions
        : typeof params.maxActions === "number"
          ? params.maxActions
          : undefined,
    max_replans:
      typeof params.max_replans === "number"
        ? params.max_replans
        : typeof params.maxReplans === "number"
          ? params.maxReplans
          : undefined,
    steps,
    inputs,
    verification,
    constraints,
    secret_inputs: Array.isArray(params.secret_inputs)
      ? params.secret_inputs.filter((v): v is string => typeof v === "string")
      : undefined,
    allowed_risks: Array.isArray(params.allowed_risks)
      ? params.allowed_risks.filter((v): v is string => typeof v === "string")
      : undefined,
  };
}
