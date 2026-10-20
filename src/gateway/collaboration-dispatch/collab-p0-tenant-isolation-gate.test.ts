/**
 * FINAL v3 P0 — Tenant isolation gate before gray enable.
 *
 * Acceptance (not "path helpers exist"):
 * 1. Managed gray allowlist requires tenantId/groupId (bare never authorizes).
 * 2. board / Todolist / wake / heartbeat / challenge-window paths: cross-tenant
 *    read / write / enumerate refuse; managed + runtimeNamespace ON does not
 *    fall back to host legacy roots.
 * 3. collaboration.runtimeWriteFreeze blocks ledger writes (board/todolist/wake/
 *    challenge/heartbeat state).
 * 4. runtimeNamespace default stays false; this suite does not flip production
 *    cutover or open LIVE / Floor flags.
 *
 * Gate: do not enable production gray writes until this suite passes.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  challengeWindowsDir,
  listChallengeWindows,
  openChallengeWindow,
} from "./challenge-window.js";
import {
  boardClaimsDir,
  isCollabTaskClaimContractEnabled,
  isGroupOnClaimContractAllowlist,
  listBoardClaimItems,
  publishBoardItem,
} from "./claim-contract.js";
import {
  executorTodolistsDir,
  listExecutorTodolists,
  proposeTodolist,
} from "./executor-private-todolist.js";
import { formatManagedGrayAllowlistKey, matchGrayGroupAllowlist } from "./gray-group-allowlist.js";
import { groupTaskHeartbeatDir, loadGroupBoardItemsForHeartbeat } from "./group-task-heartbeat.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import {
  CollaborationRuntimeWriteFrozenError,
  RUNTIME_NAMESPACE_CUTOVER_DEFAULT,
  assertCollaborationRuntimeWritable,
  isCollabRuntimeNamespaceEnabled,
  resolveCollaborationRuntimeFactPaths,
  resolveRuntimeNamespace,
} from "./runtime-namespace.js";
import {
  isCollabTaskWakeContractEnabled,
  isGroupOnWakeContractAllowlist,
  listWakeEvents,
  recordWakeEvent,
  wakeEventsDir,
} from "./wake-contract.js";

const SAMPLE_GRAY = "grp-daniel-hhd-gmail-com-upbeyond";
const TASK_ID = "task-p0-iso-1";

let tmp: string;
let collabRoot: string;
let tenantsRoot: string;
const savedEnv = { ...process.env };

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p0-iso-"));
  collabRoot = path.join(tmp, "collaboration");
  tenantsRoot = path.join(tmp, "tenants");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
  process.env.OPENBOT_STATE_DIR = path.join(tmp, "state");
});

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  process.env = { ...savedEnv };
  await fs.rm(tmp, { recursive: true, force: true });
});

function cfgFor(params: {
  runtimeNamespace?: boolean;
  runtimeWriteFreeze?: boolean;
  claimAllowlist?: string[];
  wakeAllowlist?: string[];
  claimContract?: boolean;
  wakeContract?: boolean;
  challengeWindow?: boolean;
}): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(tmp, "agent-ws") } },
    gateway: { security: { profile: "managed_enterprise" } },
    collaboration: {
      defaults: { workspace: collabRoot },
      runtimeNamespace: params.runtimeNamespace ?? true,
      ...(params.runtimeWriteFreeze !== undefined
        ? { runtimeWriteFreeze: params.runtimeWriteFreeze }
        : {}),
      task: {
        claimContract: params.claimContract ?? false,
        wakeContract: params.wakeContract ?? false,
        ...(params.claimAllowlist ? { claimContractGroupAllowlist: params.claimAllowlist } : {}),
        ...(params.wakeAllowlist ? { wakeContractGroupAllowlist: params.wakeAllowlist } : {}),
        ...(params.challengeWindow !== undefined
          ? { challengeWindow: params.challengeWindow }
          : {}),
      },
    },
  } as OpenBotConfig;
}

function useCfg(cfg: OpenBotConfig) {
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return cfg;
}

function authorityFor(
  cfg: OpenBotConfig,
  tenantId: string,
  groupId = SAMPLE_GRAY,
): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => `pss_p0_${tenantId}` },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: `ep_p0_${tenantId}`,
    tenant: { tenantId, trust: "membership" },
    groupId,
    profile: "managed_enterprise",
    cfg,
  });
}

describe("FINAL v3 P0 tenant isolation gate", () => {
  test("runtimeNamespace cutover default stays false (no N2)", () => {
    expect(RUNTIME_NAMESPACE_CUTOVER_DEFAULT).toBe(false);
    const bare = useCfg({
      agents: { defaults: { workspace: path.join(tmp, "agent-ws") } },
      gateway: { security: { profile: "managed_enterprise" } },
      collaboration: { defaults: { workspace: collabRoot } },
    } as OpenBotConfig);
    expect(isCollabRuntimeNamespaceEnabled(bare)).toBe(false);
    expect(isCollabRuntimeNamespaceEnabled({})).toBe(false);
  });

  test("managed gray allowlist: bare groupId refuses; tenantId/groupId enables only matching tenant", () => {
    const cfgBare = useCfg(cfgFor({ claimAllowlist: [SAMPLE_GRAY], wakeAllowlist: [SAMPLE_GRAY] }));
    expect(
      isGroupOnClaimContractAllowlist({ groupId: SAMPLE_GRAY, tenantId: "001", cfg: cfgBare }),
    ).toBe(false);
    expect(isCollabTaskClaimContractEnabled(cfgBare, SAMPLE_GRAY, "001")).toBe(false);
    expect(
      isGroupOnWakeContractAllowlist({ groupId: SAMPLE_GRAY, tenantId: "001", cfg: cfgBare }),
    ).toBe(false);
    expect(isCollabTaskWakeContractEnabled(cfgBare, SAMPLE_GRAY, "001")).toBe(false);

    const key001 = formatManagedGrayAllowlistKey("001", SAMPLE_GRAY);
    const cfgScoped = useCfg(cfgFor({ claimAllowlist: [key001], wakeAllowlist: [key001] }));
    expect(isCollabTaskClaimContractEnabled(cfgScoped, SAMPLE_GRAY, "001")).toBe(true);
    expect(isCollabTaskClaimContractEnabled(cfgScoped, SAMPLE_GRAY, "002")).toBe(false);
    expect(isCollabTaskWakeContractEnabled(cfgScoped, SAMPLE_GRAY, "001")).toBe(true);
    expect(isCollabTaskWakeContractEnabled(cfgScoped, SAMPLE_GRAY, "002")).toBe(false);
  });

  test("flag ON managed: same groupId under two tenants has disjoint paths; no host legacy fallback", () => {
    const cfg = useCfg(cfgFor({ runtimeNamespace: true }));
    const a = resolveRuntimeNamespace({
      tenantId: "001",
      tenantTrust: "membership",
      groupId: SAMPLE_GRAY,
      profile: "managed_enterprise",
      cfg,
    });
    const b = resolveRuntimeNamespace({
      tenantId: "002",
      tenantTrust: "membership",
      groupId: SAMPLE_GRAY,
      profile: "managed_enterprise",
      cfg,
    });
    expect(a.root).not.toBe(b.root);
    expect(a.root.startsWith(path.join(tenantsRoot, "001"))).toBe(true);
    expect(b.root.startsWith(path.join(tenantsRoot, "002"))).toBe(true);
    expect(a.root.includes(`${path.sep}tenants${path.sep}`)).toBe(true);
    expect(a.root.includes(collabRoot)).toBe(false);

    const authA = authorityFor(cfg, "001");
    const authB = authorityFor(cfg, "002");
    expect(boardClaimsDir(authA)).not.toBe(boardClaimsDir(authB));
    expect(executorTodolistsDir(authA)).not.toBe(executorTodolistsDir(authB));
    expect(wakeEventsDir(authA)).not.toBe(wakeEventsDir(authB));
    expect(groupTaskHeartbeatDir(authA)).not.toBe(groupTaskHeartbeatDir(authB));
    expect(challengeWindowsDir(authA)).not.toBe(challengeWindowsDir(authB));

    const facts = resolveCollaborationRuntimeFactPaths({
      groupId: SAMPLE_GRAY,
      tenantId: "001",
      tenantTrust: "membership",
      cfg,
    });
    expect(facts.namespace?.root).toBe(a.root);
    expect(facts.roundsDir.startsWith(path.join(tenantsRoot, "001"))).toBe(true);
    expect(facts.roundsDir.includes(collabRoot)).toBe(false);
  });

  test("cross-tenant R/W/enumerate: board, todolist, wake, challenge stay isolated", async () => {
    const key001 = formatManagedGrayAllowlistKey("001", SAMPLE_GRAY);
    const cfg = useCfg(
      cfgFor({
        runtimeNamespace: true,
        claimAllowlist: [key001],
        wakeAllowlist: [key001],
        challengeWindow: true,
      }),
    );
    const authA = authorityFor(cfg, "001");
    const authB = authorityFor(cfg, "002");

    const published = await publishBoardItem(
      authA,
      {
        groupId: SAMPLE_GRAY,
        taskId: TASK_ID,
        remainingWork: "tenant-A only deliverable",
        acceptanceCriteria: ["sources"],
        publishedBy: "bot-secretary",
        goal: "tenant-A goal",
        skipChallengeWindow: true,
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }

    const itemsA = await listBoardClaimItems(authA, { taskId: TASK_ID });
    expect(itemsA.some((item) => item.itemId === published.value.itemId)).toBe(true);
    const itemsB = await listBoardClaimItems(authB, { taskId: TASK_ID });
    expect(itemsB).toEqual([]);

    // Tenant B cannot publish with bare allowlist / wrong tenant key
    const refusedB = await publishBoardItem(
      authB,
      {
        groupId: SAMPLE_GRAY,
        taskId: TASK_ID,
        remainingWork: "should refuse — wrong tenant",
        acceptanceCriteria: ["x"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(refusedB.ok).toBe(false);
    if (!refusedB.ok) {
      expect(refusedB.reason).toBe("flag_off");
    }

    const proposed = await proposeTodolist(
      authA,
      {
        groupId: SAMPLE_GRAY,
        taskId: TASK_ID,
        boardItemId: published.value.itemId,
        ownerMemberId: "bot-analyst",
        steps: [{ title: "step-1" }],
      },
      { cfg },
    );
    expect(proposed.ok).toBe(true);
    const listsA = await listExecutorTodolists(authA, { taskId: TASK_ID });
    expect(listsA.length).toBeGreaterThan(0);
    const listsB = await listExecutorTodolists(authB, { taskId: TASK_ID });
    expect(listsB).toEqual([]);

    const wake = await recordWakeEvent(
      authA,
      {
        groupId: SAMPLE_GRAY,
        fromAgentId: "bot-secretary",
        toAgentIds: ["bot-analyst"],
        source: "nudge",
        taskId: TASK_ID,
        itemId: published.value.itemId,
      },
      { cfg },
    );
    expect(wake.ok).toBe(true);
    const wakesA = await listWakeEvents(authA, { groupId: SAMPLE_GRAY });
    expect(wakesA.length).toBeGreaterThan(0);
    const wakesB = await listWakeEvents(authB, { groupId: SAMPLE_GRAY });
    expect(wakesB).toEqual([]);

    const hbA = await loadGroupBoardItemsForHeartbeat(authA, SAMPLE_GRAY);
    expect(hbA.some((item) => item.itemId === published.value.itemId)).toBe(true);
    const hbB = await loadGroupBoardItemsForHeartbeat(authB, SAMPLE_GRAY);
    expect(hbB).toEqual([]);

    const opened = await openChallengeWindow(
      authA,
      {
        groupId: SAMPLE_GRAY,
        taskId: TASK_ID,
        leadId: "bot-secretary",
        challengerId: "bot-challenger",
        draft: {
          goal: "tenant-A goal",
          acceptanceCriteria: ["sources"],
          constraints: [],
          remainingWork: "tenant-A only deliverable",
        },
      },
      { cfg },
    );
    expect(opened.ok).toBe(true);
    const windowsA = await listChallengeWindows(authA, { taskId: TASK_ID });
    expect(windowsA.length).toBeGreaterThan(0);
    const windowsB = await listChallengeWindows(authB, { taskId: TASK_ID });
    expect(windowsB).toEqual([]);

    // Paths on disk stay under the correct tenant roots
    await expect(fs.access(boardClaimsDir(authA))).resolves.toBeUndefined();
    await expect(fs.access(boardClaimsDir(authB))).rejects.toMatchObject({ code: "ENOENT" });
    expect(boardClaimsDir(authA).startsWith(path.join(tenantsRoot, "001"))).toBe(true);
  });

  test("runtimeWriteFreeze rejects board / todolist / wake / challenge writes", async () => {
    const key001 = formatManagedGrayAllowlistKey("001", SAMPLE_GRAY);
    const cfg = useCfg(
      cfgFor({
        runtimeNamespace: true,
        runtimeWriteFreeze: true,
        claimAllowlist: [key001],
        wakeAllowlist: [key001],
        challengeWindow: true,
      }),
    );
    const auth = authorityFor(cfg, "001");

    expect(() => assertCollaborationRuntimeWritable(boardClaimsDir(auth), cfg)).toThrow(
      CollaborationRuntimeWriteFrozenError,
    );

    await expect(
      publishBoardItem(
        auth,
        {
          groupId: SAMPLE_GRAY,
          taskId: TASK_ID,
          remainingWork: "frozen",
          acceptanceCriteria: ["x"],
          publishedBy: "bot-secretary",
          skipChallengeWindow: true,
        },
        { cfg },
      ),
    ).rejects.toBeInstanceOf(CollaborationRuntimeWriteFrozenError);

    await expect(
      proposeTodolist(
        auth,
        {
          groupId: SAMPLE_GRAY,
          taskId: TASK_ID,
          boardItemId: "item-x",
          ownerMemberId: "bot-analyst",
          steps: [{ title: "s" }],
        },
        { cfg },
      ),
    ).rejects.toBeInstanceOf(CollaborationRuntimeWriteFrozenError);

    await expect(
      recordWakeEvent(
        auth,
        {
          groupId: SAMPLE_GRAY,
          fromAgentId: "bot-a",
          toAgentIds: ["bot-b"],
          source: "nudge",
        },
        { cfg },
      ),
    ).rejects.toBeInstanceOf(CollaborationRuntimeWriteFrozenError);

    await expect(
      openChallengeWindow(
        auth,
        {
          groupId: SAMPLE_GRAY,
          taskId: TASK_ID,
          leadId: "lead",
          challengerId: "blue",
          draft: {
            goal: "g",
            acceptanceCriteria: ["a"],
            constraints: [],
            remainingWork: "r",
          },
        },
        { cfg },
      ),
    ).rejects.toBeInstanceOf(CollaborationRuntimeWriteFrozenError);

    await expect(fs.stat(path.join(tenantsRoot, "001"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("match helper documents gate: production gray must not use bare managed keys", () => {
    expect(
      matchGrayGroupAllowlist({
        groupId: SAMPLE_GRAY,
        tenantId: "001",
        entries: [SAMPLE_GRAY],
      }),
    ).toBe(false);
    expect(
      matchGrayGroupAllowlist({
        groupId: SAMPLE_GRAY,
        tenantId: "001",
        entries: [formatManagedGrayAllowlistKey("001", SAMPLE_GRAY)],
      }),
    ).toBe(true);
  });
});
