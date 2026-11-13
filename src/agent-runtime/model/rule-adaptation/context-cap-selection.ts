import {
  RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION,
  type ActivatedRuntimeRulePolicySnapshot,
  type RuntimeRuleAdaptationReadBinding,
  type RuntimeRuleAdaptationReadResult,
} from "../../contracts/rule-adaptation-activation.js";
/**
 * P4 limited test wiring: typed context-cap selection for the personal
 * candidate `model.context_window.guard`.
 *
 * This is context-budget policy effective semantics, not a permission
 * credential. Cancel, revoke, and task replacement still go through
 * existing gates independently.
 *
 * Not production enablement: the default / omitted port keeps original
 * behavior completely, does not read live boards, and does not construct
 * a production HostIdentity. Production whitelist stays empty.
 * mainChainWired remains false on production/default paths.
 */
import type { TaskBoardScope } from "../../contracts/task.js";
import {
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  type ContextWindowInfo,
} from "../../policy/context-window.js";
import { boardScopesEqual } from "../../policy/rule-adaptation/activation-precheck.js";
import { isSafeIntegerNumber } from "../../policy/rule-adaptation/inspect.js";

export const CONTEXT_CAP_SELECTION_MODES = ["original", "personal_activated_snapshot"] as const;
export type ContextCapSelectionMode = (typeof CONTEXT_CAP_SELECTION_MODES)[number];

export const CONTEXT_CAP_SELECTION_SOURCES = ["original", "personal_activated_snapshot"] as const;
export type ContextCapSelectionSource = (typeof CONTEXT_CAP_SELECTION_SOURCES)[number];

export const PERSONAL_CONTEXT_WINDOW_RULE_ID = "model.context_window.guard";
export const PERSONAL_CONTEXT_WINDOW_FIELD = "agents.defaults.contextTokens";

export const CONTEXT_CAP_BLOCK_REASONS = [
  "read_failed",
  "snapshot_corrupt",
  "implementation_incompatible",
  "illegal_source",
  "identity_unverified",
  "production_path_closed",
] as const;
export type ContextCapBlockReason = (typeof CONTEXT_CAP_BLOCK_REASONS)[number];

export type ContextCapAppliedResult = {
  outcome: "applied";
  mode: ContextCapSelectionMode;
  source: ContextCapSelectionSource;
  originalTokens: number;
  tokens: number;
  snapshotParameter?: number;
};

export type ContextCapNoSnapshotResult = {
  outcome: "no_snapshot";
  mode: "personal_activated_snapshot";
  source: "original";
  originalTokens: number;
  tokens: number;
};

export type ContextCapControlledChangeResult = {
  outcome: "controlled_change";
  mode: "personal_activated_snapshot";
  source: "original";
  change: "revoked" | "rolled_back_without_effective_cap" | "superseded_without_effective_cap";
  snapshotStatus: "revoked" | "superseded";
  originalTokens: number;
  tokens: number;
};

export type ContextCapBlockedResult = {
  outcome: "blocked";
  mode: "personal_activated_snapshot";
  reason: ContextCapBlockReason;
  originalTokens: number;
};

export type ContextCapSelectionResult =
  | ContextCapAppliedResult
  | ContextCapNoSnapshotResult
  | ContextCapControlledChangeResult
  | ContextCapBlockedResult;

/**
 * Independent fixture resolution port for test wiring only.
 * The host constructs read params from a trusted test identity and session
 * binding, then checks them against on-disk TaskBoardScope.
 * Do not reverse-prove caller identity from the on-disk scope.
 * A personal task may still have a tenant.
 */
export type PersonalContextCapFixtureResolvePort = {
  kind: "fixture";
  readBinding: RuntimeRuleAdaptationReadBinding;
  onDiskBoardScope: TaskBoardScope | undefined;
  read: (binding: RuntimeRuleAdaptationReadBinding) => RuntimeRuleAdaptationReadResult;
};

/**
 * Host-injected selection port. Default / omitted means `original`.
 * Snapshot mode without a fixture port is treated as production-path-closed
 * and blocks (production reading is not opened this round).
 */
export type PersonalContextCapSelectionPort = {
  mode: ContextCapSelectionMode;
  fixtureResolve?: PersonalContextCapFixtureResolvePort;
};

function blocked(originalTokens: number, reason: ContextCapBlockReason): ContextCapBlockedResult {
  return {
    outcome: "blocked",
    mode: "personal_activated_snapshot",
    reason,
    originalTokens,
  };
}

function isCompleteBoardScope(
  scope: TaskBoardScope | RuntimeRuleAdaptationReadBinding["taskBinding"]["boardScope"] | undefined,
): scope is { tenantId: string; userId: string; sessionId: string } {
  return (
    !!scope &&
    typeof scope.tenantId === "string" &&
    scope.tenantId.trim().length > 0 &&
    typeof scope.userId === "string" &&
    scope.userId.trim().length > 0 &&
    typeof scope.sessionId === "string" &&
    scope.sessionId.trim().length > 0
  );
}

function fixtureScopeMatches(
  bindingScope: RuntimeRuleAdaptationReadBinding["taskBinding"]["boardScope"],
  onDisk: TaskBoardScope | undefined,
): boolean {
  if (!isCompleteBoardScope(bindingScope) || !isCompleteBoardScope(onDisk)) {
    return false;
  }
  return boardScopesEqual(bindingScope, {
    tenantId: onDisk.tenantId,
    userId: onDisk.userId,
    sessionId: onDisk.sessionId,
  });
}

function personalItemParameter(
  snapshot: ActivatedRuntimeRulePolicySnapshot,
): { ok: true; parameter: number } | { ok: false; reason: ContextCapBlockReason } {
  if (snapshot.implementationVersion !== RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION) {
    return { ok: false, reason: "implementation_incompatible" };
  }
  if (snapshot.whitelistSource !== "fixture") {
    // Fixture port must not treat a production-marked snapshot as enablement.
    return { ok: false, reason: "illegal_source" };
  }
  const items = Array.isArray(snapshot.items) ? snapshot.items : null;
  if (!items) {
    return { ok: false, reason: "snapshot_corrupt" };
  }
  const item = items.find(
    (entry) =>
      entry &&
      entry.ruleId === PERSONAL_CONTEXT_WINDOW_RULE_ID &&
      entry.field === PERSONAL_CONTEXT_WINDOW_FIELD,
  );
  if (!item) {
    return { ok: false, reason: "illegal_source" };
  }
  if (!isSafeIntegerNumber(item.parameter)) {
    return { ok: false, reason: "snapshot_corrupt" };
  }
  if (item.parameter < CONTEXT_WINDOW_HARD_MIN_TOKENS) {
    return { ok: false, reason: "implementation_incompatible" };
  }
  return { ok: true, parameter: item.parameter };
}

function interpretReadResult(
  originalTokens: number,
  readResult: RuntimeRuleAdaptationReadResult,
): ContextCapSelectionResult {
  if (readResult.resultKind === "rejected") {
    return blocked(originalTokens, "identity_unverified");
  }
  if (readResult.resultKind === "not_found" || !readResult.snapshot) {
    return {
      outcome: "no_snapshot",
      mode: "personal_activated_snapshot",
      source: "original",
      originalTokens,
      tokens: originalTokens,
    };
  }
  const snapshot = readResult.snapshot;
  if (snapshot.status === "revoked") {
    return {
      outcome: "controlled_change",
      mode: "personal_activated_snapshot",
      source: "original",
      change: "revoked",
      snapshotStatus: "revoked",
      originalTokens,
      tokens: originalTokens,
    };
  }
  if (snapshot.status === "superseded") {
    return {
      outcome: "controlled_change",
      mode: "personal_activated_snapshot",
      source: "original",
      change: "superseded_without_effective_cap",
      snapshotStatus: "superseded",
      originalTokens,
      tokens: originalTokens,
    };
  }
  if (snapshot.status !== "effective") {
    return blocked(originalTokens, "snapshot_corrupt");
  }
  const parameter = personalItemParameter(snapshot);
  if (!parameter.ok) {
    return blocked(originalTokens, parameter.reason);
  }
  const tokens = Math.min(originalTokens, parameter.parameter);
  return {
    outcome: "applied",
    mode: "personal_activated_snapshot",
    source: "personal_activated_snapshot",
    originalTokens,
    tokens,
    snapshotParameter: parameter.parameter,
  };
}

/**
 * Select the context cap for this model-prepare attempt.
 * When `port` is omitted or `mode` is `original`, original behavior is kept
 * completely: the fixture resolver is not consulted.
 */
export function selectPersonalContextCap(params: {
  original: ContextWindowInfo;
  port?: PersonalContextCapSelectionPort;
}): ContextCapSelectionResult {
  const originalTokens = Math.max(0, Math.floor(params.original.tokens));
  const port = params.port;
  if (!port || port.mode === "original") {
    return {
      outcome: "applied",
      mode: "original",
      source: "original",
      originalTokens,
      tokens: originalTokens,
    };
  }
  if (port.mode !== "personal_activated_snapshot") {
    return blocked(originalTokens, "illegal_source");
  }
  const fixture = port.fixtureResolve;
  if (!fixture || fixture.kind !== "fixture") {
    return blocked(originalTokens, "production_path_closed");
  }
  if (!fixtureScopeMatches(fixture.readBinding.taskBinding.boardScope, fixture.onDiskBoardScope)) {
    return blocked(originalTokens, "identity_unverified");
  }
  let readResult: RuntimeRuleAdaptationReadResult;
  try {
    readResult = fixture.read(fixture.readBinding);
  } catch {
    return blocked(originalTokens, "read_failed");
  }
  return interpretReadResult(originalTokens, readResult);
}

/**
 * Same-run downstream inheritance: never enlarge a selected cap.
 * When no inherited cap is supplied, keep the freshly resolved tokens
 * (original behavior of extensions / auto-compact).
 */
export function inheritSelectedContextCap(
  resolvedTokens: number,
  inheritedTokens: number | undefined,
): number {
  const resolved = Math.max(0, Math.floor(resolvedTokens));
  if (typeof inheritedTokens !== "number" || !Number.isFinite(inheritedTokens)) {
    return resolved;
  }
  const inherited = Math.floor(inheritedTokens);
  if (inherited <= 0) {
    return resolved;
  }
  return Math.min(resolved, inherited);
}

export function isContextCapSelectionBlocked(
  result: ContextCapSelectionResult,
): result is ContextCapBlockedResult {
  return result.outcome === "blocked";
}

export function selectedTokensOf(result: ContextCapSelectionResult): number | undefined {
  if (result.outcome === "blocked") {
    return undefined;
  }
  return result.tokens;
}

export function createFixturePersonalContextCapPort(params: {
  mode: ContextCapSelectionMode;
  readBinding: RuntimeRuleAdaptationReadBinding;
  onDiskBoardScope: TaskBoardScope | undefined;
  read: PersonalContextCapFixtureResolvePort["read"];
}): PersonalContextCapSelectionPort {
  return {
    mode: params.mode,
    fixtureResolve:
      params.mode === "personal_activated_snapshot"
        ? {
            kind: "fixture",
            readBinding: params.readBinding,
            onDiskBoardScope: params.onDiskBoardScope,
            read: params.read,
          }
        : undefined,
  };
}
