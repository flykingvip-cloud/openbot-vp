/**
 * L1 durable resume after gateway restart: scan collaboration groups with
 * incomplete board inventory and force-schedule the next milestone via
 * inventory-first continue-after-round (same path as deliverable settlement).
 *
 * Does NOT blind mid-LLM redo: never releases/retrys wake-ops in
 * running|accepted|unknown; only schedules next board milestone when
 * durable inventory still shows active work.
 *
 * Best-effort; never throws into gateway boot. Cooldown on continue still applies.
 */
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  boardClaimsDir,
  type GroupBoardClaimItem,
} from "../collaboration-dispatch/claim-contract.js";
import { episodeIdForClientRun } from "../collaboration-dispatch/collaboration-event-key.js";
import {
  maybeContinueAfterRoundComplete,
  planContinueAfterRound,
  type MaybeContinueAfterRoundResult,
} from "../collaboration-dispatch/continue-after-round.js";
import { loadBoardClaimItemsFromDir } from "../collaboration-dispatch/member-progress-export.js";
import { resolveGroupPolicyInput } from "../collaboration-dispatch/resolve-effective-policy.js";
import {
  createRoundPolicySnapshot,
  generatePolicySnapshotId,
} from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { resolveSecurityProfile } from "../security-profile.js";
import {
  createWorkspaceCollaborationStores,
  listWorkspaceCollaborationGroupIds,
  readGroupOperatingState,
  resolveCollaborationGroupTenantId,
} from "./shared.js";
import {
  resolveAuthorityTenantForEntry,
  type CollaborationTenantResolution,
} from "./trusted-tenant.js";

const log = createSubsystemLogger("gateway/resume-incomplete-board-after-restart");

/** Soft cap so a large groupRoot does not stall gateway boot. */
export const RESUME_AFTER_RESTART_MAX_GROUPS = 40;

export type ResumeIncompleteBoardGroupResult = Readonly<{
  groupId: string;
  tenantId: string | null;
  skipped: boolean;
  reason: string;
  activeBoardCount: number;
  primaryBoardItemId: string | null;
  wakeRecorded: boolean;
  selfAdvanceTriggered: boolean;
}>;

export type ResumeIncompleteBoardsAfterRestartResult = Readonly<{
  scanned: number;
  resumed: number;
  skipped: number;
  groups: ResumeIncompleteBoardGroupResult[];
}>;

export type ResumeIncompleteBoardsAfterRestartDeps = {
  listGroupIds?: (groupRootDir: string) => Promise<string[]>;
  buildAuthority?: (params: {
    groupId: string;
    cfg: OpenBotConfig;
    tenant?: CollaborationTenantResolution | null;
  }) => Promise<{ authority: RuntimeAuthority }>;
  loadBoardItems?: (authority: RuntimeAuthority) => Promise<readonly GroupBoardClaimItem[]>;
  continueRound?: (params: {
    authority: RuntimeAuthority;
    roundId: string;
    cfg: OpenBotConfig;
    nowMs: number;
    loadBoardItems: () => Promise<readonly GroupBoardClaimItem[]>;
  }) => Promise<MaybeContinueAfterRoundResult>;
  nowMs?: () => number;
  maxGroups?: number;
};

async function buildRestartResumeAuthority(params: {
  groupId: string;
  cfg: OpenBotConfig;
  tenant?: CollaborationTenantResolution | null;
}): Promise<{ authority: RuntimeAuthority }> {
  const stores = createWorkspaceCollaborationStores(params.cfg);
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
    episodeId: episodeIdForClientRun(`restart-resume:${params.groupId}`),
    tenant,
    groupId: params.groupId,
    profile,
    cfg: params.cfg,
  });
  return { authority };
}

async function defaultLoadBoardItems(
  authority: RuntimeAuthority,
): Promise<readonly GroupBoardClaimItem[]> {
  return (await loadBoardClaimItemsFromDir(boardClaimsDir(authority))) as GroupBoardClaimItem[];
}

/**
 * Scan durable boards and force-schedule next incomplete milestone per group.
 * Inventory-first; mid-LLM wake-ops are not touched.
 */
export async function resumeIncompleteBoardsAfterGatewayRestart(params: {
  cfg?: OpenBotConfig;
  deps?: ResumeIncompleteBoardsAfterRestartDeps;
}): Promise<ResumeIncompleteBoardsAfterRestartResult> {
  const cfg = params.cfg ?? loadConfig();
  const deps = params.deps ?? {};
  const nowMs = deps.nowMs?.() ?? Date.now();
  const maxGroups = Math.max(1, deps.maxGroups ?? RESUME_AFTER_RESTART_MAX_GROUPS);
  const out: ResumeIncompleteBoardGroupResult[] = [];
  let resumed = 0;
  let skipped = 0;

  try {
    const stores = createWorkspaceCollaborationStores(cfg);
    const listIds =
      deps.listGroupIds ?? ((root: string) => listWorkspaceCollaborationGroupIds(root));
    const groupIds = (await listIds(stores.groupRootDir)).slice(0, maxGroups);
    const buildAuthority = deps.buildAuthority ?? buildRestartResumeAuthority;
    const loadBoard = deps.loadBoardItems ?? defaultLoadBoardItems;
    const continueRound =
      deps.continueRound ??
      (async (args) =>
        maybeContinueAfterRoundComplete({
          authority: args.authority,
          roundId: args.roundId,
          roundState: "ROUND_COMPLETE",
          cfg: args.cfg,
          nowMs: args.nowMs,
          loadBoardItems: args.loadBoardItems,
          forceForDeliverableSettlement: true,
        }));

    for (const groupId of groupIds) {
      const trimmed = groupId.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const { authority } = await buildAuthority({ groupId: trimmed, cfg });
        const boardItems = await loadBoard(authority);
        const plan = planContinueAfterRound({ enabled: true, boardItems });
        if (plan.reason !== "active_board_inventory" || !plan.primary) {
          skipped += 1;
          out.push({
            groupId: trimmed,
            tenantId: authority.tenantId,
            skipped: true,
            reason: plan.reason,
            activeBoardCount: plan.activeItems.length,
            primaryBoardItemId: null,
            wakeRecorded: false,
            selfAdvanceTriggered: false,
          });
          continue;
        }

        const result = await continueRound({
          authority,
          roundId: `restart-resume:${trimmed}:${nowMs}`,
          cfg,
          nowMs,
          loadBoardItems: async () => boardItems,
        });

        const didResume =
          !result.skipped &&
          (result.decision.wakeRecorded ||
            result.decision.selfAdvanceTriggered ||
            result.decision.reason === "active_board_inventory");
        if (didResume) {
          resumed += 1;
        } else {
          skipped += 1;
        }
        out.push({
          groupId: trimmed,
          tenantId: authority.tenantId,
          skipped: !didResume,
          reason: result.decision.reason,
          activeBoardCount: result.decision.activeBoardCount,
          primaryBoardItemId: result.decision.primaryBoardItemId,
          wakeRecorded: result.decision.wakeRecorded,
          selfAdvanceTriggered: result.decision.selfAdvanceTriggered,
        });
      } catch (err) {
        skipped += 1;
        out.push({
          groupId: trimmed,
          tenantId: null,
          skipped: true,
          reason: `group_error:${err instanceof Error ? err.message : String(err)}`,
          activeBoardCount: 0,
          primaryBoardItemId: null,
          wakeRecorded: false,
          selfAdvanceTriggered: false,
        });
      }
    }

    log.info("resumeIncompleteBoardsAfterGatewayRestart", {
      scanned: groupIds.length,
      resumed,
      skipped,
    });
    return { scanned: groupIds.length, resumed, skipped, groups: out };
  } catch (err) {
    log.warn("resumeIncompleteBoardsAfterGatewayRestart failed", {
      detail: err instanceof Error ? err.message : String(err),
    });
    return { scanned: 0, resumed: 0, skipped: 0, groups: out };
  }
}

/**
 * Fire-and-forget boot hook. Never rejects; safe beside heartbeat / wake bind.
 */
export function scheduleResumeIncompleteBoardsAfterGatewayRestart(params?: {
  cfg?: OpenBotConfig;
  deps?: ResumeIncompleteBoardsAfterRestartDeps;
}): void {
  void resumeIncompleteBoardsAfterGatewayRestart({
    cfg: params?.cfg,
    deps: params?.deps,
  }).catch((err) => {
    log.warn("scheduleResumeIncompleteBoardsAfterGatewayRestart rejected", {
      detail: err instanceof Error ? err.message : String(err),
    });
  });
}
