/**
 * P4a — production organizer entry onto existing HandoffContract APIs.
 *
 * Reuses proposeHandoff → acceptHandoff → approveHandoff → applyApprovedHandoff only.
 * When collaboration.task.handoffContract is off, these entry points refuse.
 * The legacy collaboration.task.handoff → handoffCollaborationTask shortcut is retired
 * (T09-B1) and never mutates responsibility whether the flag is on or off.
 * Does not invent a second handoff system, Floor live, task board, or RCIS.
 */
import type { Task } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { episodeIdForClientRun } from "../collaboration-dispatch/collaboration-event-key.js";
import type { GovernanceActor } from "../collaboration-dispatch/governance-gate.js";
import {
  acceptHandoff,
  applyApprovedHandoff,
  approveHandoff,
  loadHandoffContract,
  proposeHandoff,
  type HandoffApproval,
  type HandoffContract,
  type HandoffKind,
  type HandoffResult,
  type HandoffTask,
  type ResponsibilityRole,
} from "../collaboration-dispatch/handoff-contract.js";
import { resolveGroupPolicyInput } from "../collaboration-dispatch/resolve-effective-policy.js";
import {
  createRoundPolicySnapshot,
  generatePolicySnapshotId,
} from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { applyBusinessTaskPatchUnderControlLock } from "../collaboration-dispatch/task-control-cas.js";
import {
  asGovernedTask,
  isCollabTaskHandoffContractEnabled,
  nextGovernedTaskFields,
  normalizeTaskHandoff,
} from "../collaboration-dispatch/task-runtime.js";
import { resolveSecurityProfile } from "../security-profile.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  resolveCollaborationGroupTenantId,
  syncGroupOperatingState,
} from "./shared.js";
import { assertPersistedTaskNotStopped } from "./task-stop-entry.js";
import {
  resolveAuthorityTenantForEntry,
  type CollaborationTenantResolution,
} from "./trusted-tenant.js";

export class HandoffContractFlagOffError extends Error {
  readonly code = "HANDOFF_CONTRACT_FLAG_OFF";
  constructor() {
    super(
      "collaboration.task.handoffContract is off; enable the flag (gray/explicit deploy only — not silent platform LIVE) to run propose → accept → approve → apply. The collaboration.task.handoff shortcut is retired and does not mutate",
    );
    this.name = "HandoffContractFlagOffError";
  }
}

export class HandoffContractEntryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HandoffContractEntryError";
    this.code = code;
  }
}

function unwrap<T>(result: HandoffResult<T>, step: string): T {
  if (result.ok) {
    return result.value;
  }
  if (result.reason === "flag_off") {
    throw new HandoffContractFlagOffError();
  }
  throw new HandoffContractEntryError(result.reason, `${step}: ${result.message}`);
}

function looksLikeBot(agentId: string): boolean {
  const id = agentId.trim().toLowerCase();
  return (
    id.startsWith("bot:") ||
    id.startsWith("agent:") ||
    id.startsWith("bot-") ||
    id.startsWith("agent-")
  );
}

export function resolveHandoffGovernanceActor(params: {
  actorId?: string | null;
  actorType?: "human" | "bot";
}): GovernanceActor {
  const id = params.actorId?.trim();
  if (!id) {
    throw new HandoffContractEntryError("actor_required", "actor is required");
  }
  if (params.actorType === "human" || params.actorType === "bot") {
    return { type: params.actorType, id };
  }
  return { type: looksLikeBot(id) ? "bot" : "human", id };
}

async function buildHandoffAuthority(params: {
  groupId: string;
  taskId: string;
  cfg: OpenBotConfig;
  tenant?: CollaborationTenantResolution | null;
}) {
  const stores = createWorkspaceCollaborationStores();
  const operatingState = await readGroupOperatingState({
    fileStore: stores.fileStore,
    groupId: params.groupId,
  });
  const now = Date.now();
  const snapshot = createRoundPolicySnapshot(resolveGroupPolicyInput({ operatingState }), {
    now,
    idGen: () => generatePolicySnapshotId(now),
  });
  const groupTenantId = resolveCollaborationGroupTenantId(params.groupId);
  const tenant: CollaborationTenantResolution = resolveAuthorityTenantForEntry({
    preferred: params.tenant,
    groupTenantId,
  });
  const profile = resolveSecurityProfile(params.cfg).profile;
  const authority = createRuntimeAuthority({
    snapshot,
    episodeId: episodeIdForClientRun(`task-handoff:${params.groupId}:${params.taskId}`),
    tenant,
    groupId: params.groupId,
    profile,
    cfg: params.cfg,
  });
  return { authority, stores, operatingState };
}

function requireFlag(cfg: OpenBotConfig): void {
  if (!isCollabTaskHandoffContractEnabled(cfg)) {
    throw new HandoffContractFlagOffError();
  }
}

async function refuseIfTaskStopped(params: {
  groupId: string;
  taskId: string;
  cfg: OpenBotConfig;
}): Promise<void> {
  await assertPersistedTaskNotStopped(params);
}

export type ProposeCollaborationTaskHandoffContractParams = {
  groupId: string;
  taskId: string;
  from: string;
  to: string;
  remainingWork: string;
  acceptanceCriteria: string[];
  kind?: HandoffKind;
  fromRole?: ResponsibilityRole;
  toRole?: ResponsibilityRole;
  completedArtifacts?: string[];
  assumptions?: string[];
  blockers?: string[];
  requiresApproval?: HandoffApproval;
  proposedBy?: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
};

export async function proposeCollaborationTaskHandoffContract(
  params: ProposeCollaborationTaskHandoffContractParams,
): Promise<HandoffContract> {
  const cfg = params.cfg ?? loadConfig();
  requireFlag(cfg);
  await refuseIfTaskStopped({ groupId: params.groupId, taskId: params.taskId, cfg });
  const { authority, stores } = await buildHandoffAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const current = await stores.objectStorage.readObject<Task>(
    params.groupId,
    "task",
    params.taskId,
  );
  if (!current) {
    throw new HandoffContractEntryError("task_not_found", `task not found: ${params.taskId}`);
  }
  const kind: HandoffKind = params.kind ?? "owner_transfer";
  const fromRole: ResponsibilityRole =
    params.fromRole ?? (kind === "owner_transfer" ? "owner" : "executor");
  const toRole: ResponsibilityRole =
    params.toRole ?? (kind === "owner_transfer" ? "owner" : "executor");
  const proposedBy = params.proposedBy?.trim() || params.actor?.trim() || params.from.trim();
  return unwrap(
    await proposeHandoff(
      authority,
      {
        taskId: params.taskId,
        kind,
        from: { agentId: params.from, responsibilityRole: fromRole },
        to: { agentId: params.to, responsibilityRole: toRole },
        remainingWork: params.remainingWork,
        acceptanceCriteria: params.acceptanceCriteria,
        completedArtifacts: params.completedArtifacts,
        assumptions: params.assumptions,
        blockers: params.blockers,
        requiresApproval: params.requiresApproval,
        proposedBy,
      },
      { cfg },
    ),
    "proposeHandoff",
  );
}

export type HandoffContractStepParams = {
  groupId: string;
  taskId: string;
  handoffId: string;
  actor?: string;
  actorType?: "human" | "bot";
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
  /** Test-only: after outside read, before control-lock write. */
  _testAfterTaskReadBarrier?: () => Promise<void>;
};

export async function acceptCollaborationTaskHandoffContract(
  params: HandoffContractStepParams,
): Promise<HandoffContract> {
  const cfg = params.cfg ?? loadConfig();
  requireFlag(cfg);
  await refuseIfTaskStopped({ groupId: params.groupId, taskId: params.taskId, cfg });
  const { authority } = await buildHandoffAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const contract = await loadHandoffContract(authority, {
    taskId: params.taskId,
    handoffId: params.handoffId,
  });
  if (!contract) {
    throw new HandoffContractEntryError(
      "handoff_not_found",
      `handoff not found: ${params.handoffId}`,
    );
  }
  const by = resolveHandoffGovernanceActor({
    actorId: params.actor,
    actorType: params.actorType,
  });
  return unwrap(await acceptHandoff(authority, contract, by, { cfg }), "acceptHandoff");
}

export async function approveCollaborationTaskHandoffContract(
  params: HandoffContractStepParams,
): Promise<HandoffContract> {
  const cfg = params.cfg ?? loadConfig();
  requireFlag(cfg);
  await refuseIfTaskStopped({ groupId: params.groupId, taskId: params.taskId, cfg });
  const { authority } = await buildHandoffAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const contract = await loadHandoffContract(authority, {
    taskId: params.taskId,
    handoffId: params.handoffId,
  });
  if (!contract) {
    throw new HandoffContractEntryError(
      "handoff_not_found",
      `handoff not found: ${params.handoffId}`,
    );
  }
  const by = resolveHandoffGovernanceActor({
    actorId: params.actor,
    actorType: params.actorType ?? "human",
  });
  return unwrap(await approveHandoff(authority, contract, by, { cfg }), "approveHandoff");
}

export async function applyCollaborationTaskHandoffContract(
  params: HandoffContractStepParams,
): Promise<Task> {
  const cfg = params.cfg ?? loadConfig();
  requireFlag(cfg);
  await refuseIfTaskStopped({ groupId: params.groupId, taskId: params.taskId, cfg });
  const { authority, stores } = await buildHandoffAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const contract = await loadHandoffContract(authority, {
    taskId: params.taskId,
    handoffId: params.handoffId,
  });
  if (!contract) {
    throw new HandoffContractEntryError(
      "handoff_not_found",
      `handoff not found: ${params.handoffId}`,
    );
  }
  const current = await stores.objectStorage.readObject<Task>(
    params.groupId,
    "task",
    params.taskId,
  );
  if (!current) {
    throw new HandoffContractEntryError("task_not_found", `task not found: ${params.taskId}`);
  }
  const governed = asGovernedTask(current);
  const handoffTask: HandoffTask = {
    ...governed,
    responsibility: governed.responsibility,
  };
  const applied = unwrap(
    await applyApprovedHandoff(authority, contract, handoffTask, { cfg }),
    "applyApprovedHandoff",
  );
  const responsibility = applied.task.responsibility;
  if (!responsibility) {
    throw new HandoffContractEntryError(
      "responsibility_missing",
      "applyApprovedHandoff returned no responsibility",
    );
  }
  const history = normalizeTaskHandoff({
    taskId: contract.taskId,
    from: contract.from.agentId,
    to: contract.to.agentId,
    reason: contract.kind,
    remainingWork: contract.remainingWork,
    acceptanceCriteria: [...contract.acceptanceCriteria],
    completedArtifacts: [...contract.completedArtifacts],
    assumptions: [...contract.assumptions],
    blockers: [...contract.blockers],
  });
  const handoffsNext = [...(governed.handoffs ?? []), history];
  if (params._testAfterTaskReadBarrier) {
    await params._testAfterTaskReadBarrier();
  }
  const updated = await applyBusinessTaskPatchUnderControlLock({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    refuseIfStopped: true,
    buildPatch: (live) => {
      const now = Date.now();
      const liveGoverned = asGovernedTask(live);
      const governanceFields = nextGovernedTaskFields({
        task: liveGoverned,
        liveStatus: live.status,
        responsibility,
        handoffs: handoffsNext,
      });
      return {
        ...governanceFields,
        updatedBy: params.actor ?? live.updatedBy,
        updatedAtMs: now,
      };
    },
  });
  await syncGroupOperatingState({
    fileStore: stores.fileStore,
    groupStorage: stores.groupStorage,
    metadataStorage: stores.metadataStorage,
    memoryStorage: stores.memoryStorage,
    learningStorage: stores.learningStorage,
    objectStorage: stores.objectStorage,
    groupId: params.groupId,
  });
  return updated;
}
