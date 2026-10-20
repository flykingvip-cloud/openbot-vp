/**
 * Orchestration Plane — invariants (P4.5).
 *
 * Threat model:
 *  - ORCH1 Skip-ahead: choosing browser when a connector/web_read suffices.
 *  - ORCH2 Sandbox≠node: workspace paths routed as node_fs_read/node_exec, or
 *         nodeId smuggled onto a ConversationTask row (CT2).
 *  - ORCH3 Master-switch bypass: dispatchEnabled forcing node/browser while
 *         those surface switches are off.
 *  - ORCH4 Dormant invoke: any tool call / job when the kernel is dormant.
 *  - ORCH5 CTR outrun: treating CTR activation as orchestration enable, or
 *         dispatching while CTR is still shadow-only.
 *  - ORCH6 Mission smuggling: minting a P7 Mission / treating sessions_spawn
 *         workers as a Mission.
 *  - ORCH7 Ledger I1: assistant_text / model_claim as orchestrator evidence.
 *  - ORCH8 Skill-as-evidence: treating skill expand as Evidence.
 */

import type { ConversationTask } from "../conversation-task/types.js";
import type { DispatchResult } from "./dispatch.js";
import { OrchestrationInvariantError } from "./errors.js";
import { isOrchestrationDormant } from "./feature.js";
import type { OrchestratorLedgerIntent } from "./ledger-bridge.js";
import { isForbiddenLedgerEvidence } from "./ledger-bridge.js";
import type { SkillBoundStepDraft } from "./skill-binder.js";
import { DORMANT_GRAYSCALE_SURFACES, type SurfaceToolBinding } from "./surface-binding.js";
import {
  PERSONAL_SUBAGENT_MAX_DEPTH,
  type ExecutionSurface,
  type OrchestrationFlags,
  type PersonalSubagentBinding,
  type RouteStepInput,
  type SurfaceDecision,
} from "./types.js";

export type OrchestrationInvariantId =
  | "ORCH1"
  | "ORCH2"
  | "ORCH3"
  | "ORCH4"
  | "ORCH5"
  | "ORCH6"
  | "ORCH7"
  | "ORCH8";

function fail(id: OrchestrationInvariantId, message: string): never {
  throw new OrchestrationInvariantError(id, message);
}

/** ORCH1 — no skip-ahead on the capability ladder. */
export function assertNoSkipAhead(input: RouteStepInput, decision: SurfaceDecision): void {
  if (decision.kind === "blocked_policy") {
    return;
  }
  const connected = input.connectedConnectorIds ?? [];
  const connectorReady =
    connected.length > 0 &&
    (!input.requestedConnectorId || connected.includes(input.requestedConnectorId));
  if (decision.surface === "browser" && connectorReady) {
    fail("ORCH1", "must not choose browser when a connector is already available");
  }
  if (input.intent === "read_web" && decision.surface === "browser") {
    fail("ORCH1", "must not choose browser for a web_read-capable step");
  }
}

/** ORCH2 — gateway workspace is not the user machine. */
export function assertSandboxIsNotNode(input: RouteStepInput, decision: SurfaceDecision): void {
  if (input.pathKind !== "workspace") {
    return;
  }
  if (decision.surface === "node_fs_read" || decision.surface === "node_exec") {
    fail("ORCH2", "workspace-relative path must not route as a node surface");
  }
}

/**
 * ORCH2 — node bindings live in the orchestration partition, never on the
 * ConversationTask identity row (A1 schema freeze / CT2).
 */
export function assertNodeBindingNotOnTask(task: ConversationTask): void {
  const record = task as unknown as Record<string, unknown>;
  if (record.nodeId !== undefined) {
    fail("ORCH2", "nodeId must not live on ConversationTask; bind in orchestration partition");
  }
  for (const field of ["steps", "progress", "running"] as const) {
    if (record[field] !== undefined) {
      fail("ORCH2", `ConversationTask must not carry execution field "${field}"`);
    }
  }
}

/** ORCH3 — dispatchEnabled cannot force node/browser when those masters are off. */
export function assertMasterSwitchesHonored(
  flags: OrchestrationFlags,
  decision: SurfaceDecision,
): void {
  if (
    !flags.nodeEnabled &&
    (decision.surface === "node_fs_read" || decision.surface === "node_exec")
  ) {
    if (decision.kind === "selected") {
      fail("ORCH3", "node surface selected while nodeEnabled is off");
    }
  }
  if (!flags.browserEnabled && decision.surface === "browser" && decision.kind === "selected") {
    fail("ORCH3", "browser surface selected while browserEnabled is off");
  }
}

function isNodeOrBrowserSurface(surface: ExecutionSurface | undefined): boolean {
  return surface === "node_fs_read" || surface === "node_exec" || surface === "browser";
}

/** ORCH3 helper: a permitted dispatch still cannot select a gated surface. */
export function assertDispatchCannotForceGatedSurface(
  flags: OrchestrationFlags,
  decision: SurfaceDecision,
): void {
  assertMasterSwitchesHonored(flags, decision);
  if (
    flags.dispatchEnabled &&
    isNodeOrBrowserSurface(decision.surface) &&
    decision.kind === "selected"
  ) {
    if (decision.surface === "browser" && !flags.browserEnabled) {
      fail("ORCH3", "dispatchEnabled must not force browser");
    }
    if (
      (decision.surface === "node_fs_read" || decision.surface === "node_exec") &&
      !flags.nodeEnabled
    ) {
      fail("ORCH3", "dispatchEnabled must not force node surfaces");
    }
  }
}

/** ORCH4 — dormant kernel observes 0, writes 0, invokes 0. */
export function assertDormantIsIdle(flags: OrchestrationFlags, result: DispatchResult): void {
  if (!isOrchestrationDormant(flags)) {
    return;
  }
  if (result.job !== null) {
    fail("ORCH4", "dormant dispatch must not materialize a job");
  }
  if (result.invokedTool || result.createdConversationTask || result.wroteLedger) {
    fail("ORCH4", "dormant dispatch must not invoke, create tasks, or write ledger");
  }
  if (result.decision.invoke || result.decision.enqueue) {
    fail("ORCH4", "dormant decision must not enqueue or invoke");
  }
  if (result.surfaceBindings.length > 0) {
    fail("ORCH4", "dormant dispatch must not observe grayscale bindings");
  }
}

/** ORCH5 — CTR activation is not orchestration enable; dispatch cannot outrun CTR. */
export function assertActivationIsNotOrchestrationEnable(
  flags: OrchestrationFlags,
  ctrActivationEnabled: boolean,
  result: DispatchResult,
): void {
  if (isOrchestrationDormant(flags) && ctrActivationEnabled) {
    if (result.job !== null || result.invokedTool || result.createdConversationTask) {
      fail("ORCH5", "CTR activation must not enable orchestration");
    }
  }
  if (!ctrActivationEnabled) {
    if (result.job !== null || result.createdConversationTask || result.invokedTool) {
      fail("ORCH5", "orchestration must not create tasks or invoke while CTR is shadow-only");
    }
  }
}

/** ORCH6 — personal subagents are not Missions; depth is capped. */
export function assertPersonalSubagentIsNotMission(binding: PersonalSubagentBinding): void {
  if (binding.kind !== "personal_subagent" || !binding.notMission) {
    fail("ORCH6", "personal subagent binding must declare notMission");
  }
  if (binding.depth > PERSONAL_SUBAGENT_MAX_DEPTH) {
    fail("ORCH6", `personal subagent depth ${binding.depth} exceeds cap`);
  }
}

export function assertNoMissionKind(kind: string): void {
  if (kind === "mission") {
    fail("ORCH6", "orchestration must not mint a Mission (P7 only)");
  }
}

/** ORCH7 — ledger bridge outputs cannot use forbidden evidence types. */
export function assertLedgerBridgeHonorsI1(intent: OrchestratorLedgerIntent): void {
  if (intent.evidenceType && isForbiddenLedgerEvidence(intent.evidenceType)) {
    fail("ORCH7", `forbidden evidence type: ${intent.evidenceType}`);
  }
  if (intent.ackOnly && intent.eventType === "STEP_COMPLETED") {
    fail("ORCH7", "ack is not delivery; cannot complete a step from ack");
  }
}

/** ORCH8 — skill expand is a recipe, not Evidence. */
export function assertSkillExpandIsNotEvidence(draft: SkillBoundStepDraft): void {
  if (draft.evidenceEligible || !draft.skillIsRecipe) {
    fail("ORCH8", "skill expand must not be eligible as evidence");
  }
}

/** P4.5 live invoke is type-frozen off. */
export function assertNeverInvoke(decision: SurfaceDecision, result?: DispatchResult): void {
  if (decision.invoke) {
    fail("ORCH4", "P4.5 must not invoke tools");
  }
  if (result?.invokedTool) {
    fail("ORCH4", "P4.5 dispatch must not invoke tools");
  }
}

/** P4.5f — grayscale bindings are name-only; this slice allowlists web/browser/node. */
export function assertGrayscaleBindingDoesNotInvoke(
  bindings: readonly SurfaceToolBinding[],
  result?: DispatchResult,
): void {
  if (
    DORMANT_GRAYSCALE_SURFACES.length !== 4 ||
    DORMANT_GRAYSCALE_SURFACES[0] !== "web_read" ||
    DORMANT_GRAYSCALE_SURFACES[1] !== "browser" ||
    DORMANT_GRAYSCALE_SURFACES[2] !== "node_fs_read" ||
    DORMANT_GRAYSCALE_SURFACES[3] !== "node_exec"
  ) {
    fail("ORCH4", "this slice allowlists web_read, browser, node_fs_read, node_exec");
  }
  for (const binding of bindings) {
    if (
      binding.surface !== "web_read" &&
      binding.surface !== "browser" &&
      binding.surface !== "node_fs_read" &&
      binding.surface !== "node_exec"
    ) {
      fail("ORCH4", "this slice only binds grayscale surfaces");
    }
    if (binding.execute) {
      fail("ORCH4", "grayscale bindings must be name-only (execute false)");
    }
  }
  if (result?.invokedTool) {
    fail("ORCH4", "grayscale dispatch must not invoke tools");
  }
}
