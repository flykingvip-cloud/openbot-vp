import type {
  ActivatedRuntimeRulePolicySnapshot,
  ActivationPrecheckContext,
  RuntimeRuleAdaptationActivationResult,
  RuntimeRuleAdaptationReadResult,
  RuntimeRuleAdaptationTaskRecord,
  RuntimeRuleWhitelistEntry,
} from "../../contracts/rule-adaptation-activation.js";
import {
  ACTIVATION_EFFECTIVE_NODE,
  RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION,
} from "../../contracts/rule-adaptation-activation.js";
import type { RuntimeRuleAdaptationExpectedPolicyVersion } from "../../contracts/rule-adaptation.js";
import type { PolicyProposalInput } from "../../contracts/rule-adaptation.js";
/**
 * P3 controlled host entries for activation, revoke, rollback, and read.
 * These are not mounted on the P1 validator or the P2 shadow runner.
 * They call the state mutation entry and do not open the main chain.
 * Command organizes the use case (authorize/precheck → state entry → map results).
 * It does not hold the board lock or perform bare repository read/write for
 * activate / revoke / rollback transactions. Policy stays a pure precheck.
 */
import type { SessionTaskBoard } from "../../contracts/task.js";
import { getRuntimeRuleDeclaration } from "../../policy/catalog.js";
import {
  activationAccessScopeVerified,
  activationReason,
  deepFreezeActivation,
  precheckRuntimeRuleActivation,
  precheckRuntimeRuleRead,
  precheckRuntimeRuleRevoke,
  precheckRuntimeRuleRollback,
  resolveActivationWhitelist,
  whitelistHit,
} from "../../policy/rule-adaptation/activation-precheck.js";
import { isKnownCatalogRuleId } from "../../policy/rule-adaptation/descriptors.js";
import {
  mutateRuntimeRuleAdaptationBoard,
  officialRuntimeRuleAdaptationBoardIo,
  readRuntimeRuleAdaptationBoard,
  type RuntimeRuleAdaptationBoardIo,
} from "../../state/mutations/runtime-rule-adaptation.js";

export type ActivationBoardIo = RuntimeRuleAdaptationBoardIo;

export const officialActivationBoardIo: ActivationBoardIo = officialRuntimeRuleAdaptationBoardIo;

export type ActivationHostDependencies = {
  sessionFile: string;
  fixtureWhitelist?: readonly RuntimeRuleWhitelistEntry[];
  currentImplementationVersion?: string;
  currentExpectedPolicyVersion?: RuntimeRuleAdaptationExpectedPolicyVersion;
  takenDownRuleIds?: readonly string[];
  liveClaimToken?: string;
  boardIo?: ActivationBoardIo;
};

function contextFromDeps(
  deps: ActivationHostDependencies,
  liveBoard?: SessionTaskBoard,
): ActivationPrecheckContext {
  return {
    ...(liveBoard ? { liveBoard } : {}),
    currentImplementationVersion:
      deps.currentImplementationVersion ?? RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION,
    ...(deps.currentExpectedPolicyVersion
      ? { currentExpectedPolicyVersion: deps.currentExpectedPolicyVersion }
      : {}),
    ...(deps.fixtureWhitelist ? { fixtureWhitelist: deps.fixtureWhitelist } : {}),
    ...(deps.takenDownRuleIds ? { takenDownRuleIds: deps.takenDownRuleIds } : {}),
    ...(deps.liveClaimToken ? { liveClaimToken: deps.liveClaimToken } : {}),
  };
}

function boardIo(deps: ActivationHostDependencies): ActivationBoardIo {
  return deps.boardIo ?? officialActivationBoardIo;
}

function recordOf(
  board: SessionTaskBoard,
  taskId: string,
): RuntimeRuleAdaptationTaskRecord | undefined {
  const raw = board.runtimeRuleAdaptationByTaskId?.[taskId];
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const history = Array.isArray(raw.history)
    ? (raw.history as ActivatedRuntimeRulePolicySnapshot[])
    : [];
  return {
    ...(raw.current ? { current: raw.current as ActivatedRuntimeRulePolicySnapshot } : {}),
    history,
  };
}

function cloneRecord(
  record: RuntimeRuleAdaptationTaskRecord | undefined,
): RuntimeRuleAdaptationTaskRecord {
  return {
    ...(record?.current ? { current: record.current } : {}),
    history: record?.history ? [...record.history] : [],
  };
}

function taskIdFromUnknownBinding(binding: unknown): string {
  if (
    binding &&
    typeof binding === "object" &&
    "taskBinding" in binding &&
    binding.taskBinding &&
    typeof binding.taskBinding === "object" &&
    "taskId" in binding.taskBinding &&
    typeof binding.taskBinding.taskId === "string"
  ) {
    return binding.taskBinding.taskId;
  }
  return "";
}

function freezeResult<T extends object>(value: T): T {
  return deepFreezeActivation(structuredClone(value));
}

function catalogVersionFor(ruleId: string): string {
  return getRuntimeRuleDeclaration(ruleId)?.version ?? "inventory:unknown";
}

function authorizedRetainedSnapshot(
  board: SessionTaskBoard,
  binding: unknown,
  proposal?: unknown,
): ActivatedRuntimeRulePolicySnapshot | undefined {
  if (!activationAccessScopeVerified(binding, board, proposal)) {
    return undefined;
  }
  const taskId = taskIdFromUnknownBinding(binding);
  return taskId ? recordOf(board, taskId)?.current : undefined;
}

function boardEpochIfAuthorized(
  board: SessionTaskBoard,
  binding: unknown,
  proposal?: unknown,
): { boardWriteEpoch: number } | Record<string, never> {
  if (!activationAccessScopeVerified(binding, board, proposal)) {
    return {};
  }
  return { boardWriteEpoch: typeof board.writeEpoch === "number" ? board.writeEpoch : 0 };
}

function persistFailedResult(
  message: string,
  board: SessionTaskBoard,
  binding: unknown,
  proposal?: unknown,
): RuntimeRuleAdaptationActivationResult {
  const retained = authorizedRetainedSnapshot(board, binding, proposal);
  return freezeResult({
    resultKind: "persist_failed",
    reasons: [activationReason("structural_unusable_host_value", message, "persist")],
    ...(retained ? { retainedSnapshot: retained } : {}),
    ...boardEpochIfAuthorized(board, binding, proposal),
  });
}

function buildActivatedSnapshot(params: {
  proposal: PolicyProposalInput;
  binding: {
    taskBinding: { taskId: string; boardScope: ActivatedRuntimeRulePolicySnapshot["boardScope"] };
    identity: ActivatedRuntimeRulePolicySnapshot["actor"];
    authorizationReference: string;
    approvedCandidateIdentity?: ActivatedRuntimeRulePolicySnapshot["approvedCandidateIdentity"];
    hostActivationGate: ActivatedRuntimeRulePolicySnapshot["hostActivationGate"];
    permission?: ActivatedRuntimeRulePolicySnapshot["permission"];
    nowMs: number;
  };
  writeEpoch: number;
  whitelistSource: ActivatedRuntimeRulePolicySnapshot["whitelistSource"];
  operation: ActivatedRuntimeRulePolicySnapshot["operation"];
  status: ActivatedRuntimeRulePolicySnapshot["status"];
  supersededWriteEpoch?: number;
  revokeReason?: ActivatedRuntimeRulePolicySnapshot["revokeReason"];
  items?: ActivatedRuntimeRulePolicySnapshot["items"];
}): ActivatedRuntimeRulePolicySnapshot {
  const items =
    params.items ??
    params.proposal.items.map((item) => ({
      ruleId: item.ruleId,
      field: item.field,
      action: item.action,
      parameter: item.proposedValue,
    }));
  const primaryRuleId = items[0]?.ruleId ?? params.proposal.items[0]?.ruleId ?? "";
  return {
    status: params.status,
    operation: params.operation,
    taskId: params.binding.taskBinding.taskId,
    scope: params.proposal.scope,
    boardScope: params.binding.taskBinding.boardScope,
    items,
    implementationVersion: params.proposal.implementationVersion,
    catalogVersion: catalogVersionFor(primaryRuleId),
    policyHash: params.proposal.expectedPolicyVersion.policyHash,
    protocolVersion: params.proposal.expectedPolicyVersion.protocolVersion,
    compilerRevision: params.proposal.expectedPolicyVersion.compilerRevision,
    writeEpoch: params.writeEpoch,
    authorizationReference: params.binding.authorizationReference,
    ...(params.binding.approvedCandidateIdentity
      ? { approvedCandidateIdentity: params.binding.approvedCandidateIdentity }
      : {}),
    hostActivationGate: params.binding.hostActivationGate,
    ...(params.binding.permission ? { permission: params.binding.permission } : {}),
    actor: params.binding.identity,
    recordedAtMs: params.binding.nowMs,
    effectiveNode: ACTIVATION_EFFECTIVE_NODE,
    whitelistSource: params.whitelistSource,
    mainChainWired: false,
    ...(params.supersededWriteEpoch !== undefined
      ? { supersededWriteEpoch: params.supersededWriteEpoch }
      : {}),
    ...(params.revokeReason ? { revokeReason: params.revokeReason } : {}),
  };
}

function writtenEpochOf(written: SessionTaskBoard, fallback: number): number {
  return typeof written.writeEpoch === "number" ? written.writeEpoch : fallback;
}

function nextRecordedBoard(
  live: SessionTaskBoard,
  taskId: string,
  nextSnapshot: ActivatedRuntimeRulePolicySnapshot,
  diskEpoch: number,
): SessionTaskBoard {
  const existing = cloneRecord(recordOf(live, taskId));
  const history = [...existing.history];
  if (existing.current) {
    history.push({ ...existing.current, status: "superseded" });
  }
  const map = { ...live.runtimeRuleAdaptationByTaskId };
  map[taskId] = { current: nextSnapshot, history };
  return {
    ...live,
    runtimeRuleAdaptationByTaskId: map,
    writeEpoch: diskEpoch,
  };
}

export function activateApprovedRuntimeRuleProposal(
  proposal: unknown,
  binding: unknown,
  deps: ActivationHostDependencies,
): RuntimeRuleAdaptationActivationResult {
  const io = boardIo(deps);
  const live = readRuntimeRuleAdaptationBoard(deps.sessionFile, io);
  const precheck = precheckRuntimeRuleActivation(proposal, binding, contextFromDeps(deps, live));
  if (!precheck.ok) {
    const retained = authorizedRetainedSnapshot(live, binding, proposal);
    return freezeResult({
      resultKind: precheck.resultKind,
      reasons: precheck.reasons,
      ...(retained ? { retainedSnapshot: retained } : {}),
      ...boardEpochIfAuthorized(live, binding, proposal),
      ...(precheck.whitelistSource ? { whitelistSource: precheck.whitelistSource } : {}),
      ...(precheck.authorizationAssessment
        ? { authorizationAssessment: precheck.authorizationAssessment }
        : {}),
    });
  }

  try {
    return mutateRuntimeRuleAdaptationBoard<RuntimeRuleAdaptationActivationResult>(
      deps.sessionFile,
      (lockedLive) => {
        const lockedCheck = precheckRuntimeRuleActivation(
          proposal,
          binding,
          contextFromDeps(deps, lockedLive),
        );
        const lockedRetained = authorizedRetainedSnapshot(lockedLive, binding, proposal);
        const diskEpoch = typeof lockedLive.writeEpoch === "number" ? lockedLive.writeEpoch : 0;
        if (!lockedCheck.ok) {
          return {
            action: "abort",
            value: freezeResult({
              resultKind: lockedCheck.resultKind,
              reasons: lockedCheck.reasons,
              ...(lockedRetained ? { retainedSnapshot: lockedRetained } : {}),
              ...boardEpochIfAuthorized(lockedLive, binding, proposal),
              ...(lockedCheck.whitelistSource
                ? { whitelistSource: lockedCheck.whitelistSource }
                : {}),
              ...(lockedCheck.authorizationAssessment
                ? { authorizationAssessment: lockedCheck.authorizationAssessment }
                : {}),
            }),
          };
        }
        const parsedProposal = proposal as PolicyProposalInput;
        const nextSnapshot = buildActivatedSnapshot({
          proposal: parsedProposal,
          binding: lockedCheck.binding,
          writeEpoch: diskEpoch + 1,
          whitelistSource: lockedCheck.whitelistSource,
          operation: "activate",
          status: "effective",
          supersededWriteEpoch: recordOf(lockedLive, lockedCheck.binding.taskBinding.taskId)
            ?.current?.writeEpoch,
        });
        return {
          action: "write",
          board: nextRecordedBoard(
            lockedLive,
            lockedCheck.binding.taskBinding.taskId,
            nextSnapshot,
            diskEpoch,
          ),
          value: (written) => {
            const writtenEpoch = writtenEpochOf(written, diskEpoch + 1);
            const frozen = { ...nextSnapshot, writeEpoch: writtenEpoch };
            return freezeResult({
              resultKind: "activated",
              reasons: [],
              snapshot: frozen,
              boardWriteEpoch: writtenEpoch,
              whitelistSource: frozen.whitelistSource,
              authorizationAssessment: "host_authorized",
            });
          },
        };
      },
      io,
    );
  } catch {
    const disk = readRuntimeRuleAdaptationBoard(deps.sessionFile, io);
    return persistFailedResult(
      "Activation compare passed but persistence failed; the previous snapshot remains and no partial write is kept.",
      disk,
      binding,
      proposal,
    );
  }
}

export function revokeActivatedRuntimeRulePolicy(
  binding: unknown,
  deps: ActivationHostDependencies,
): RuntimeRuleAdaptationActivationResult {
  const io = boardIo(deps);
  const live = readRuntimeRuleAdaptationBoard(deps.sessionFile, io);
  const precheck = precheckRuntimeRuleRevoke(binding, contextFromDeps(deps, live));
  if (!precheck.ok || !precheck.parsed) {
    const retained = authorizedRetainedSnapshot(live, binding);
    return freezeResult({
      resultKind: precheck.resultKind,
      reasons: precheck.reasons,
      ...(retained ? { retainedSnapshot: retained } : {}),
      ...boardEpochIfAuthorized(live, binding),
    });
  }
  try {
    return mutateRuntimeRuleAdaptationBoard<RuntimeRuleAdaptationActivationResult>(
      deps.sessionFile,
      (lockedLive) => {
        const lockedCheck = precheckRuntimeRuleRevoke(binding, contextFromDeps(deps, lockedLive));
        const diskEpoch = typeof lockedLive.writeEpoch === "number" ? lockedLive.writeEpoch : 0;
        const lockedRetained = authorizedRetainedSnapshot(lockedLive, binding);
        if (!lockedCheck.ok || !lockedCheck.parsed) {
          return {
            action: "abort",
            value: freezeResult({
              resultKind: lockedCheck.resultKind,
              reasons: lockedCheck.reasons,
              ...(lockedRetained ? { retainedSnapshot: lockedRetained } : {}),
              ...boardEpochIfAuthorized(lockedLive, binding),
            }),
          };
        }
        const current = recordOf(lockedLive, lockedCheck.parsed.taskBinding.taskId)?.current;
        if (!current) {
          return {
            action: "abort",
            value: freezeResult({
              resultKind: "rejected" as const,
              reasons: [
                activationReason(
                  "task_not_bound",
                  "There is no activated snapshot to revoke for this taskId.",
                  "binding.taskBinding.taskId",
                ),
              ],
              boardWriteEpoch: diskEpoch,
            }),
          };
        }
        const nextSnapshot: ActivatedRuntimeRulePolicySnapshot = {
          ...current,
          status: "revoked",
          operation: "revoke",
          writeEpoch: diskEpoch + 1,
          authorizationReference: lockedCheck.parsed.authorizationReference,
          hostActivationGate: lockedCheck.parsed.hostActivationGate,
          actor: lockedCheck.parsed.identity,
          recordedAtMs: lockedCheck.parsed.nowMs,
          effectiveNode: ACTIVATION_EFFECTIVE_NODE,
          mainChainWired: false,
          supersededWriteEpoch: current.writeEpoch,
          revokeReason: lockedCheck.parsed.revokeReason,
        };
        return {
          action: "write",
          board: nextRecordedBoard(
            lockedLive,
            lockedCheck.parsed.taskBinding.taskId,
            nextSnapshot,
            diskEpoch,
          ),
          value: (written) => {
            const writtenEpoch = writtenEpochOf(written, diskEpoch + 1);
            const frozen = { ...nextSnapshot, writeEpoch: writtenEpoch };
            return freezeResult({
              resultKind: "activated" as const,
              reasons: [],
              snapshot: frozen,
              boardWriteEpoch: writtenEpoch,
            });
          },
        };
      },
      io,
    );
  } catch {
    const disk = readRuntimeRuleAdaptationBoard(deps.sessionFile, io);
    return persistFailedResult(
      "Revoke compare passed but persistence failed; the previous snapshot remains.",
      disk,
      binding,
    );
  }
}

export function rollbackActivatedRuntimeRulePolicy(
  binding: unknown,
  deps: ActivationHostDependencies,
): RuntimeRuleAdaptationActivationResult {
  const io = boardIo(deps);
  const live = readRuntimeRuleAdaptationBoard(deps.sessionFile, io);
  const precheck = precheckRuntimeRuleRollback(binding, contextFromDeps(deps, live));
  if (!precheck.ok || !precheck.parsed) {
    const retained = authorizedRetainedSnapshot(live, binding);
    return freezeResult({
      resultKind: precheck.resultKind,
      reasons: precheck.reasons,
      ...(retained ? { retainedSnapshot: retained } : {}),
      ...boardEpochIfAuthorized(live, binding),
      ...(precheck.whitelistSource ? { whitelistSource: precheck.whitelistSource } : {}),
    });
  }
  try {
    return mutateRuntimeRuleAdaptationBoard<RuntimeRuleAdaptationActivationResult>(
      deps.sessionFile,
      (lockedLive) => {
        const lockedCheck = precheckRuntimeRuleRollback(binding, contextFromDeps(deps, lockedLive));
        const diskEpoch = typeof lockedLive.writeEpoch === "number" ? lockedLive.writeEpoch : 0;
        const record = lockedCheck.parsed
          ? recordOf(lockedLive, lockedCheck.parsed.taskBinding.taskId)
          : undefined;
        const lockedRetained = authorizedRetainedSnapshot(lockedLive, binding);
        if (!lockedCheck.ok || !lockedCheck.parsed) {
          return {
            action: "abort",
            value: freezeResult({
              resultKind: lockedCheck.resultKind,
              reasons: lockedCheck.reasons,
              ...(lockedRetained ? { retainedSnapshot: lockedRetained } : {}),
              ...boardEpochIfAuthorized(lockedLive, binding),
            }),
          };
        }
        const current = record?.current;
        const target =
          (current && current.writeEpoch === lockedCheck.parsed.targetWriteEpoch
            ? current
            : undefined) ??
          record?.history.find((row) => row.writeEpoch === lockedCheck.parsed?.targetWriteEpoch);
        const rejectLocked = (
          code: Parameters<typeof activationReason>[0],
          message: string,
          path: string,
        ): RuntimeRuleAdaptationActivationResult =>
          freezeResult({
            resultKind: "rejected" as const,
            reasons: [activationReason(code, message, path)],
            ...(lockedRetained ? { retainedSnapshot: lockedRetained } : {}),
            boardWriteEpoch: diskEpoch,
          });
        if (!target) {
          return {
            action: "abort",
            value: rejectLocked(
              "unapproved_candidate",
              "The rollback target writeEpoch is not present in the immutable history of this task.",
              "binding.targetWriteEpoch",
            ),
          };
        }
        if (target.status === "revoked" || target.operation === "revoke") {
          return {
            action: "abort",
            value: rejectLocked(
              "rollback_restores_revoked_rights",
              "Rollback must not restore revoked rights or a revoked historical snapshot.",
              "binding.targetWriteEpoch",
            ),
          };
        }
        const { source, entries } = resolveActivationWhitelist(
          lockedCheck.parsed.fixture === true,
          deps.fixtureWhitelist,
        );
        for (const item of target.items) {
          if (
            (deps.takenDownRuleIds ?? []).includes(item.ruleId) ||
            !isKnownCatalogRuleId(item.ruleId)
          ) {
            return {
              action: "abort",
              value: rejectLocked(
                "rule_taken_down",
                "Rollback must not re-enable a taken-down rule.",
                "binding.targetWriteEpoch",
              ),
            };
          }
          if (
            entries.length === 0 ||
            !whitelistHit(entries, item.ruleId, item.field, item.action)
          ) {
            return {
              action: "abort",
              value: rejectLocked(
                entries.length === 0 ? "empty_whitelist" : "whitelist_miss",
                "Rollback is re-checked against the current whitelist and current authorization.",
                "binding.targetWriteEpoch",
              ),
            };
          }
          if (lockedCheck.parsed.permission && item.action !== lockedCheck.parsed.permission) {
            return {
              action: "abort",
              value: rejectLocked(
                "permission_axis_mismatch",
                "The current permission axis does not cover the historical item action.",
                "binding.permission",
              ),
            };
          }
        }
        const nextSnapshot: ActivatedRuntimeRulePolicySnapshot = {
          ...target,
          status: "effective",
          operation: "rollback",
          writeEpoch: diskEpoch + 1,
          authorizationReference: lockedCheck.parsed.authorizationReference,
          hostActivationGate: lockedCheck.parsed.hostActivationGate,
          permission: lockedCheck.parsed.permission,
          actor: lockedCheck.parsed.identity,
          recordedAtMs: lockedCheck.parsed.nowMs,
          effectiveNode: ACTIVATION_EFFECTIVE_NODE,
          whitelistSource: source,
          mainChainWired: false,
          supersededWriteEpoch: current?.writeEpoch,
          policyHash: lockedCheck.parsed.expectedPolicyVersion.policyHash,
          protocolVersion: lockedCheck.parsed.expectedPolicyVersion.protocolVersion,
          compilerRevision: lockedCheck.parsed.expectedPolicyVersion.compilerRevision,
        };
        delete (nextSnapshot as { revokeReason?: unknown }).revokeReason;
        return {
          action: "write",
          board: nextRecordedBoard(
            lockedLive,
            lockedCheck.parsed.taskBinding.taskId,
            nextSnapshot,
            diskEpoch,
          ),
          value: (written) => {
            const writtenEpoch = writtenEpochOf(written, diskEpoch + 1);
            const frozen = { ...nextSnapshot, writeEpoch: writtenEpoch };
            return freezeResult({
              resultKind: "activated" as const,
              reasons: [],
              snapshot: frozen,
              boardWriteEpoch: writtenEpoch,
              whitelistSource: source,
              authorizationAssessment: "host_authorized" as const,
            });
          },
        };
      },
      io,
    );
  } catch {
    const disk = readRuntimeRuleAdaptationBoard(deps.sessionFile, io);
    return persistFailedResult(
      "Rollback compare passed but persistence failed; the previous snapshot remains.",
      disk,
      binding,
    );
  }
}

export function readActivatedRuntimeRulePolicy(
  binding: unknown,
  deps: ActivationHostDependencies,
): RuntimeRuleAdaptationReadResult {
  const io = boardIo(deps);
  const live = readRuntimeRuleAdaptationBoard(deps.sessionFile, io);
  const precheck = precheckRuntimeRuleRead(binding, contextFromDeps(deps, live));
  if (!precheck.ok || !precheck.parsed) {
    return freezeResult({
      resultKind: "rejected",
      reasons: precheck.reasons,
      ...boardEpochIfAuthorized(live, binding),
    });
  }
  const record = recordOf(live, precheck.parsed.taskBinding.taskId);
  if (!record?.current) {
    return freezeResult({
      resultKind: "not_found",
      reasons: [],
      history: record?.history ?? [],
      boardWriteEpoch: typeof live.writeEpoch === "number" ? live.writeEpoch : 0,
    });
  }
  return freezeResult({
    resultKind: "found",
    reasons: [],
    snapshot: record.current,
    history: record.history,
    boardWriteEpoch: typeof live.writeEpoch === "number" ? live.writeEpoch : 0,
  });
}
