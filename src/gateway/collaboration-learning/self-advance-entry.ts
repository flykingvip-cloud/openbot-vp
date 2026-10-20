/**
 * P4 / FINAL v3 S5 — production entry for limited self_advance (Governance Gate caller).
 *
 * Composition root for RPC `collaboration.task.trySelfAdvance`.
 * S5: default write mode dry_run (decision ledger only); execute requires
 * collab.task.selfAdvance.mode=execute + executeGroupAllowlist. Per-tick reauth.
 * Does not flip LIVE / claim|wake allowlists / platform botMaySelfAdvance default.
 * Does not auto-complete / submit / accept.
 */
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { episodeIdForClientRun } from "../collaboration-dispatch/collaboration-event-key.js";
import { resolveGroupPolicyInput } from "../collaboration-dispatch/resolve-effective-policy.js";
import {
  createRoundPolicySnapshot,
  generatePolicySnapshotId,
} from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { trySelfAdvance, type SelfAdvanceResult } from "../collaboration-dispatch/self-advance.js";
import { resolveSecurityProfile } from "../security-profile.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  resolveCollaborationGroupTenantId,
} from "./shared.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

async function buildSelfAdvanceAuthority(params: {
  groupId: string;
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
  const tenant: CollaborationTenantResolution = params.tenant ?? {
    tenantId: groupTenantId,
    trust: groupTenantId ? "actor_fallback" : "none",
  };
  const profile = resolveSecurityProfile(params.cfg).profile;
  const authority = createRuntimeAuthority({
    snapshot,
    episodeId: episodeIdForClientRun(`task-self-advance:${params.groupId}`),
    tenant,
    groupId: params.groupId,
    profile,
    cfg: params.cfg,
  });
  const mission =
    (operatingState as { activeContext?: { currentMission?: string | null } } | null)?.activeContext
      ?.currentMission ??
    (operatingState as { groupProfile?: { currentMission?: string | null } } | null)?.groupProfile
      ?.currentMission ??
    null;
  return { authority, operatingState, mission };
}

/** Production self_advance tick — non-zero Governance Gate caller. */
export async function runCollaborationSelfAdvance(params: {
  groupId: string;
  actorId: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
  dryRun?: boolean;
  nowMs?: number;
  fromAgentId?: string;
}): Promise<SelfAdvanceResult> {
  const cfg = params.cfg ?? loadConfig();
  const { authority, mission } = await buildSelfAdvanceAuthority({
    groupId: params.groupId,
    cfg,
    tenant: params.tenant,
  });
  return trySelfAdvance(authority, {
    cfg,
    actorId: params.actorId,
    currentMission: mission,
    dryRun: params.dryRun,
    nowMs: params.nowMs,
    fromAgentId: params.fromAgentId,
    triggerSource: "rpc:trySelfAdvance",
  });
}
