/**
 * WP-02 — Gateway bootstrap for collaboration task-handoff crash recovery.
 *
 * Thin wiring only: discover groups with pending `*.txn` under known collaboration
 * layouts, build a recovery RuntimeAuthority per group, call
 * `recoverPendingHandoffTxns`. Flag `collaboration.task.handoffContract` default
 * false → no-op (same as the recover API). Errors are logged by the caller;
 * this module does not block gateway start.
 *
 * Does not change handoff permissions, flag defaults, or take over
 * collaboration-dispatch/**.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../config/types.js";
import { recoverPendingHandoffTxns } from "./collaboration-dispatch/handoff-contract.js";
import { createRoundPolicySnapshot } from "./collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "./collaboration-dispatch/runtime-authority.js";
import {
  isCollabRuntimeNamespaceEnabled,
  type RuntimeNamespaceProfile,
} from "./collaboration-dispatch/runtime-namespace.js";
import { isCollabTaskHandoffContractEnabled } from "./collaboration-dispatch/task-runtime.js";
import { resolveSecurityProfile } from "./security-profile.js";
import { resolveTenantsRoot } from "./tenant-store-paths.js";
import { resolveTrustedCollaborationGroupsRoot } from "./workspace/group-locator.js";

export type HandoffRecoveryBootResult = {
  rolledForward: string[];
  groupsScanned: number;
  groupsRecovered: number;
};

export type HandoffRecoveryBootLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

type PendingGroup = {
  groupId: string;
  tenantId: string | null;
  profile: RuntimeNamespaceProfile;
  handoffsDir: string;
};

async function dirHasPendingTxn(handoffsDir: string): Promise<boolean> {
  let names: string[];
  try {
    names = await fs.readdir(handoffsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
  return names.some((name) => name.endsWith(".txn"));
}

async function listGroupEntries(groupsRoot: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(groupsRoot, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Discover group locators that currently hold a pending handoff `*.txn`.
 * personal_local always; managed_enterprise tenants only when runtimeNamespace is on.
 */
export async function discoverPendingHandoffGroups(cfg: OpenBotConfig): Promise<PendingGroup[]> {
  const out: PendingGroup[] = [];
  const seen = new Set<string>();

  const pushIfPending = async (params: {
    groupDirName: string;
    groupsRoot: string;
    tenantId: string | null;
    profile: RuntimeNamespaceProfile;
  }) => {
    let groupId: string;
    try {
      groupId = decodeURIComponent(params.groupDirName);
    } catch {
      groupId = params.groupDirName;
    }
    if (!groupId.trim()) {
      return;
    }
    const handoffsDir = path.join(params.groupsRoot, params.groupDirName, "runtime", "handoffs");
    if (!(await dirHasPendingTxn(handoffsDir))) {
      return;
    }
    const key = `${params.profile}:${params.tenantId ?? ""}:${groupId}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({
      groupId,
      tenantId: params.tenantId,
      profile: params.profile,
      handoffsDir,
    });
  };

  const personalRoot = resolveTrustedCollaborationGroupsRoot({
    profile: "personal_local",
    cfg,
  });
  for (const name of await listGroupEntries(personalRoot)) {
    await pushIfPending({
      groupDirName: name,
      groupsRoot: personalRoot,
      tenantId: null,
      profile: "personal_local",
    });
  }

  if (isCollabRuntimeNamespaceEnabled(cfg)) {
    let tenantNames: string[] = [];
    try {
      tenantNames = await listGroupEntries(resolveTenantsRoot());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    for (const tenantId of tenantNames) {
      const groupsRoot = resolveTrustedCollaborationGroupsRoot({
        profile: "managed_enterprise",
        tenantId,
        cfg,
      });
      for (const name of await listGroupEntries(groupsRoot)) {
        await pushIfPending({
          groupDirName: name,
          groupsRoot,
          tenantId,
          profile: "managed_enterprise",
        });
      }
    }
  }

  return out;
}

function recoveryAuthority(params: {
  groupId: string;
  tenantId: string | null;
  profile: RuntimeNamespaceProfile;
  cfg: OpenBotConfig;
}) {
  const now = Date.now();
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    {
      now,
      idGen: () => `pss_handoff_recover_${params.groupId}_${now}`,
    },
  );
  // When runtimeNamespace is off, createRuntimeAuthority forces personal_local layout.
  const profile = isCollabRuntimeNamespaceEnabled(params.cfg) ? params.profile : "personal_local";
  const securityProfile = resolveSecurityProfile(params.cfg).profile;
  const effectiveProfile =
    profile === "managed_enterprise" && securityProfile === "managed_enterprise"
      ? ("managed_enterprise" as const)
      : ("personal_local" as const);
  return createRuntimeAuthority({
    snapshot,
    episodeId: `ep_handoff_recover_${params.groupId}`,
    tenant:
      params.tenantId && effectiveProfile === "managed_enterprise"
        ? { tenantId: params.tenantId, trust: "actor_fallback" }
        : { tenantId: null, trust: "none" },
    groupId: params.groupId,
    profile: effectiveProfile,
    cfg: params.cfg,
  });
}

/**
 * Gateway-startup entry: recover all pending handoff txns across discovered groups.
 * Safe no-op when handoffContract is off or no `*.txn` files exist.
 */
export async function recoverPendingHandoffTxnsAtGatewayBoot(params: {
  cfg: OpenBotConfig;
  log?: HandoffRecoveryBootLog;
}): Promise<HandoffRecoveryBootResult> {
  const { cfg, log } = params;
  if (!isCollabTaskHandoffContractEnabled(cfg)) {
    return { rolledForward: [], groupsScanned: 0, groupsRecovered: 0 };
  }

  const pending = await discoverPendingHandoffGroups(cfg);
  const rolledForward: string[] = [];
  let groupsRecovered = 0;

  for (const group of pending) {
    try {
      const authority = recoveryAuthority({
        groupId: group.groupId,
        tenantId: group.tenantId,
        profile: group.profile,
        cfg,
      });
      // Prefer authority.namespace.handoffsDir (canonical) over scan path.
      if (authority.namespace.handoffsDir !== group.handoffsDir) {
        log?.warn?.(
          `handoff recovery: scanned ${group.handoffsDir} but authority resolves ${authority.namespace.handoffsDir}; using authority`,
        );
      }
      const result = await recoverPendingHandoffTxns({ authority, cfg });
      if (result.rolledForward.length > 0) {
        groupsRecovered += 1;
        rolledForward.push(...result.rolledForward);
        log?.info?.(
          `handoff recovery: group=${group.groupId} rolledForward=${result.rolledForward.join(",")}`,
        );
      }
    } catch (error) {
      log?.warn?.(`handoff recovery failed for group=${group.groupId}: ${String(error)}`);
    }
  }

  return {
    rolledForward,
    groupsScanned: pending.length,
    groupsRecovered,
  };
}
