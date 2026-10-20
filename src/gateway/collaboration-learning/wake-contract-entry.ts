/**
 * C2 follow-up — production read-only entry for Wake Contract ledger.
 *
 * listWakeEvents / whoWokeWhom do not require wakeContract flag (observe AS-IS).
 * Writers stay on chat.send hook + claim/handoff paths; this entry does not write.
 */
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { episodeIdForClientRun } from "../collaboration-dispatch/collaboration-event-key.js";
import {
  buildAdminDailySummaryForGroup,
  runGroupTaskHeartbeat,
  type GroupTaskHeartbeatOptions,
  type GroupTaskHeartbeatResult,
} from "../collaboration-dispatch/group-task-heartbeat.js";
import { resolveGroupPolicyInput } from "../collaboration-dispatch/resolve-effective-policy.js";
import {
  createRoundPolicySnapshot,
  generatePolicySnapshotId,
} from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import {
  listWakeEvents,
  whoWokeWhom,
  type WakeEvent,
  type WakeOutcome,
  type WakeSource,
} from "../collaboration-dispatch/wake-contract.js";
import { resolveSecurityProfile } from "../security-profile.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  resolveCollaborationGroupTenantId,
} from "./shared.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

async function buildWakeAuthority(params: {
  groupId: string;
  cfg: OpenBotConfig;
  tenant?: CollaborationTenantResolution | null;
  taskId?: string;
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
  const tenant: CollaborationTenantResolution = params.tenant ?? {
    tenantId: groupTenantId,
    trust: groupTenantId ? "actor_fallback" : "none",
  };
  const profile = resolveSecurityProfile(params.cfg).profile;
  const episodeSeed = params.taskId
    ? `task-wake:${params.groupId}:${params.taskId}`
    : `task-wake:${params.groupId}`;
  const authority = createRuntimeAuthority({
    snapshot,
    episodeId: episodeIdForClientRun(episodeSeed),
    tenant,
    groupId: params.groupId,
    profile,
    cfg: params.cfg,
  });
  return { authority, operatingState };
}

/** Read-only wake-events for a group (optional taskId filter). */
export async function listCollaborationWakeEvents(params: {
  groupId: string;
  taskId?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<WakeEvent[]> {
  const cfg = params.cfg ?? loadConfig();
  const { authority } = await buildWakeAuthority({
    groupId: params.groupId,
    cfg,
    tenant: params.tenant,
    taskId: params.taskId,
  });
  return listWakeEvents(authority, {
    groupId: params.groupId,
    taskId: params.taskId,
  });
}

export type WhoWokeWhomRow = {
  from: string;
  to: string;
  source: WakeSource;
  outcome: WakeOutcome;
  at: number;
  wakeId: string;
};

/** Read-only timeline answering「谁唤醒了谁」. */
export async function getCollaborationWhoWokeWhom(params: {
  groupId: string;
  taskId?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<{ events: WakeEvent[]; timeline: WhoWokeWhomRow[] }> {
  const events = await listCollaborationWakeEvents(params);
  return { events, timeline: whoWokeWhom(events) };
}

/** P3/S4: cron-shaped group task heartbeat (reads board; wake only in emit mode). */
export async function runCollaborationGroupTaskHeartbeat(params: {
  groupId: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
  force?: boolean;
  nowMs?: number;
  coordinatorBotId?: string | null;
  groupOwnerId?: string | null;
  actorId?: string;
  /** S4: observe/dry-run — plan + persist, never write wake. */
  dryRun?: boolean;
}): Promise<GroupTaskHeartbeatResult> {
  const cfg = params.cfg ?? loadConfig();
  const { authority, operatingState } = await buildWakeAuthority({
    groupId: params.groupId,
    cfg,
    tenant: params.tenant,
  });
  const gov = (operatingState as { governance?: { coordinatorBotId?: string | null } } | null)
    ?.governance;
  const options: GroupTaskHeartbeatOptions = {
    cfg,
    force: params.force,
    nowMs: params.nowMs,
    coordinatorBotId: params.coordinatorBotId ?? gov?.coordinatorBotId ?? null,
    groupOwnerId: params.groupOwnerId,
    actorId: params.actorId,
    dryRun: params.dryRun,
    tenantId: params.tenant?.tenantId ?? authority.tenantId,
  };
  return runGroupTaskHeartbeat(authority, { groupId: params.groupId }, options);
}

/** P3.4 optional: one admin C0/C1 daily summary (not spam). */
export async function getCollaborationAdminDailySummary(params: {
  groupId: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
  nowMs?: number;
}): Promise<{ message: string }> {
  const cfg = params.cfg ?? loadConfig();
  const { authority } = await buildWakeAuthority({
    groupId: params.groupId,
    cfg,
    tenant: params.tenant,
  });
  const result = await buildAdminDailySummaryForGroup(authority, {
    groupId: params.groupId,
    cfg,
    nowMs: params.nowMs,
  });
  return { message: result.message };
}
