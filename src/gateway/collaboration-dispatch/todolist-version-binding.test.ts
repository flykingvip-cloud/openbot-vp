/**
 * Batch 3 — plan-version binding for confirm / revise.
 *
 * Reproduction (against the pre-fix loader, now locked as assertions):
 * - New propose mints a new id and supersedes the old one. Confirming the old
 *   id does not confirm either plan (card_invalid).
 * - Re-propose with the same todolistId, or revise that replaces steps, keeps
 *   the id and moves the latest row. A confirm that omits expectedVersion, or
 *   sends the previous version, must not write confirmed.
 * - Reason-only revise does not change steps or version, so a confirm of that
 *   same version still applies the original steps.
 * - Two concurrent confirms of one version append a single confirmed line.
 *
 * expectedSubmissionId matching is asserted here so this batch cannot weaken it.
 * Confirmer ACL is unchanged: the owner still cannot self-confirm.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  confirmTodolist,
  executorTodolistLogPath,
  executorTodolistsDir,
  loadExecutorTodolist,
  proposeTodolist,
  reviseTodolist,
  type ExecutorPrivateTodolist,
} from "./executor-private-todolist.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import { pendingSubmissionMatches } from "./submit-review-versioning.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const savedSecurityProfile = process.env.OPENBOT_SECURITY_PROFILE;
const savedLegacySecurityProfile = process.env.OPENCLAW_SECURITY_PROFILE;

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  if (savedStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = savedStateDir;
  }
  if (savedOpenbotConfigPath === undefined) {
    delete process.env.OPENBOT_CONFIG_PATH;
  } else {
    process.env.OPENBOT_CONFIG_PATH = savedOpenbotConfigPath;
  }
  if (savedOpenclawConfigPath === undefined) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = savedOpenclawConfigPath;
  }
  if (savedSecurityProfile === undefined) {
    delete process.env.OPENBOT_SECURITY_PROFILE;
  } else {
    process.env.OPENBOT_SECURITY_PROFILE = savedSecurityProfile;
  }
  if (savedLegacySecurityProfile === undefined) {
    delete process.env.OPENCLAW_SECURITY_PROFILE;
  } else {
    process.env.OPENCLAW_SECURITY_PROFILE = savedLegacySecurityProfile;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function useConfig(): Promise<{ cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-todolist-version-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { claimContract: true },
    },
  } as OpenBotConfig;
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { cfg };
}

function authority(cfg: OpenBotConfig): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_version_test" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_version",
    tenant: { tenantId: null, trust: "none" },
    groupId: "grp_ver",
    profile: "personal_local",
    cfg,
  });
}

const confirmOpts = { authorizedConfirmerIds: ["bot-secretary"] as const };

async function propose(
  auth: RuntimeAuthority,
  cfg: OpenBotConfig,
  steps: Array<{ title: string }>,
  todolistId?: string,
): Promise<ExecutorPrivateTodolist> {
  const result = await proposeTodolist(
    auth,
    {
      boardItemId: "bi-ver",
      taskId: "task-ver",
      groupId: "grp_ver",
      ownerMemberId: "bot-analyst",
      steps,
      ...(todolistId ? { todolistId } : {}),
    },
    { cfg },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.value;
}

async function logStatuses(auth: RuntimeAuthority, taskId: string): Promise<string[]> {
  const raw = await fs.readFile(
    executorTodolistLogPath(executorTodolistsDir(auth), taskId),
    "utf8",
  );
  const statuses: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const parsed = JSON.parse(line) as { todolist?: { status?: string } };
    if (parsed.todolist?.status) {
      statuses.push(parsed.todolist.status);
    }
  }
  return statuses;
}

describe("todolist plan version binding", () => {
  test("new id supersede: old card does not confirm either plan", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const first = await propose(auth, cfg, [{ title: "旧步骤" }]);
    const next = await propose(auth, cfg, [{ title: "新步骤" }]);
    expect(next.todolistId).not.toBe(first.todolistId);
    expect(next.status).toBe("proposed");

    const omitted = await confirmTodolist(
      auth,
      { taskId: "task-ver", todolistId: first.todolistId, confirmerId: "bot-secretary" },
      { cfg, ...confirmOpts },
    );
    expect(omitted.ok).toBe(false);
    if (!omitted.ok) {
      expect(omitted.reason).toBe("card_invalid");
      expect(omitted.message).toContain("旧版本已失效");
      expect(omitted.message).not.toContain("旧步骤");
      expect(omitted.message).not.toContain("新步骤");
    }

    const versioned = await confirmTodolist(
      auth,
      {
        taskId: "task-ver",
        todolistId: first.todolistId,
        confirmerId: "bot-secretary",
        expectedVersion: first.version,
      },
      { cfg, ...confirmOpts },
    );
    expect(versioned.ok).toBe(false);
    if (!versioned.ok) {
      expect(versioned.reason).toBe("card_invalid");
    }

    const dead = await loadExecutorTodolist(auth, {
      taskId: "task-ver",
      todolistId: first.todolistId,
    });
    const live = await loadExecutorTodolist(auth, {
      taskId: "task-ver",
      todolistId: next.todolistId,
    });
    expect(dead?.status).toBe("superseded");
    expect(live?.status).toBe("proposed");
    expect(live?.steps[0]?.title).toBe("新步骤");
    expect(await logStatuses(auth, "task-ver")).not.toContain("confirmed");
  });

  test("same id re-propose: omit and stale version do not confirm the new steps", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const first = await propose(auth, cfg, [{ title: "旧步骤" }]);
    const next = await propose(auth, cfg, [{ title: "新步骤" }], first.todolistId);
    expect(next.todolistId).toBe(first.todolistId);
    expect(next.version).toBe(first.version + 1);

    const stale = await confirmTodolist(
      auth,
      {
        taskId: "task-ver",
        todolistId: first.todolistId,
        confirmerId: "bot-secretary",
        expectedVersion: first.version,
      },
      { cfg, ...confirmOpts },
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toBe("stale_version");
      expect(stale.message).toContain("stale_version");
      expect(stale.message).toContain("旧版本已失效");
      expect(stale.message).not.toContain("新步骤");
    }

    const omitted = await confirmTodolist(
      auth,
      { taskId: "task-ver", todolistId: first.todolistId, confirmerId: "bot-secretary" },
      { cfg, ...confirmOpts },
    );
    expect(omitted.ok).toBe(false);
    if (!omitted.ok) {
      expect(omitted.reason).toBe("expected_version_required");
      expect(omitted.message).toContain("确认必须绑定计划版本");
      expect(omitted.message).not.toContain("新步骤");
    }

    const future = await confirmTodolist(
      auth,
      {
        taskId: "task-ver",
        todolistId: first.todolistId,
        confirmerId: "bot-secretary",
        expectedVersion: next.version + 4,
      },
      { cfg, ...confirmOpts },
    );
    expect(future.ok).toBe(false);
    if (!future.ok) {
      expect(future.reason).toBe("version_mismatch");
      expect(future.message).toContain("计划版本不匹配");
    }

    const pending = await loadExecutorTodolist(auth, {
      taskId: "task-ver",
      todolistId: first.todolistId,
    });
    expect(pending?.status).toBe("proposed");
    expect(pending?.version).toBe(next.version);
    expect(pending?.steps[0]?.title).toBe("新步骤");

    const confirmed = await confirmTodolist(
      auth,
      {
        taskId: "task-ver",
        todolistId: next.todolistId,
        confirmerId: "bot-secretary",
        expectedVersion: next.version,
      },
      { cfg, ...confirmOpts },
    );
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.value.status).toBe("confirmed");
      expect(confirmed.value.steps[0]?.title).toBe("新步骤");
      expect(confirmed.value.version).toBe(next.version);
    }
  });

  test("step revise bumps version; old confirm does not apply the new steps", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const first = await propose(auth, cfg, [{ title: "旧步骤" }]);
    const revised = await reviseTodolist(
      auth,
      {
        taskId: "task-ver",
        todolistId: first.todolistId,
        reviserId: "bot-secretary",
        reason: "改步骤",
        steps: [{ title: "改后步骤" }],
        expectedVersion: first.version,
      },
      { cfg, ...confirmOpts },
    );
    expect(revised.ok).toBe(true);
    if (!revised.ok) {
      return;
    }
    expect(revised.value.version).toBe(first.version + 1);
    expect(revised.value.status).toBe("revise_requested");

    const staleRevise = await reviseTodolist(
      auth,
      {
        taskId: "task-ver",
        todolistId: first.todolistId,
        reviserId: "bot-secretary",
        reason: "旧卡再改",
        steps: [{ title: "不该写入" }],
        expectedVersion: first.version,
      },
      { cfg, ...confirmOpts },
    );
    expect(staleRevise.ok).toBe(false);
    if (!staleRevise.ok) {
      expect(staleRevise.reason).toBe("stale_version");
      expect(staleRevise.message).not.toContain("不该写入");
    }

    const staleConfirm = await confirmTodolist(
      auth,
      {
        taskId: "task-ver",
        todolistId: first.todolistId,
        confirmerId: "bot-secretary",
        expectedVersion: first.version,
      },
      { cfg, ...confirmOpts },
    );
    expect(staleConfirm.ok).toBe(false);
    if (!staleConfirm.ok) {
      expect(staleConfirm.reason).toBe("stale_version");
    }

    const omitted = await confirmTodolist(
      auth,
      { taskId: "task-ver", todolistId: first.todolistId, confirmerId: "bot-secretary" },
      { cfg, ...confirmOpts },
    );
    expect(omitted.ok).toBe(false);
    if (!omitted.ok) {
      expect(omitted.reason).toBe("expected_version_required");
    }

    const pending = await loadExecutorTodolist(auth, {
      taskId: "task-ver",
      todolistId: first.todolistId,
    });
    expect(pending?.status).toBe("revise_requested");
    expect(pending?.steps[0]?.title).toBe("改后步骤");
    expect(pending?.version).toBe(revised.value.version);

    const confirmed = await confirmTodolist(
      auth,
      {
        taskId: "task-ver",
        todolistId: first.todolistId,
        confirmerId: "bot-secretary",
        expectedVersion: revised.value.version,
      },
      { cfg, ...confirmOpts },
    );
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.value.steps[0]?.title).toBe("改后步骤");
    }
  });

  test("reason-only revise keeps the version, so the same card still confirms original steps", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const first = await propose(auth, cfg, [{ title: "原步骤" }]);
    const revised = await reviseTodolist(
      auth,
      {
        taskId: "task-ver",
        todolistId: first.todolistId,
        reviserId: "bot-secretary",
        reason: "只退回，不改步骤",
        expectedVersion: first.version,
      },
      { cfg, ...confirmOpts },
    );
    expect(revised.ok).toBe(true);
    if (!revised.ok) {
      return;
    }
    expect(revised.value.version).toBe(first.version);
    expect(revised.value.steps[0]?.title).toBe("原步骤");

    const confirmed = await confirmTodolist(
      auth,
      {
        taskId: "task-ver",
        todolistId: first.todolistId,
        confirmerId: "bot-secretary",
        expectedVersion: first.version,
      },
      { cfg, ...confirmOpts },
    );
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.value.status).toBe("confirmed");
      expect(confirmed.value.steps[0]?.title).toBe("原步骤");
      expect(confirmed.value.version).toBe(first.version);
    }
  });

  test("concurrent confirms of one version append a single confirmed line", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const first = await propose(auth, cfg, [{ title: "一步" }]);
    const input = {
      taskId: "task-ver",
      todolistId: first.todolistId,
      confirmerId: "bot-secretary",
      expectedVersion: first.version,
    };
    const [left, right] = await Promise.all([
      confirmTodolist(auth, input, { cfg, ...confirmOpts }),
      confirmTodolist(auth, input, { cfg, ...confirmOpts }),
    ]);
    const oks = [left, right].filter((result) => result.ok);
    const consumed = [left, right].filter(
      (result) => !result.ok && result.reason === "confirmation_consumed",
    );
    expect(oks).toHaveLength(1);
    expect(consumed).toHaveLength(1);
    const statuses = await logStatuses(auth, "task-ver");
    expect(statuses.filter((status) => status === "confirmed")).toHaveLength(1);
    const loaded = await loadExecutorTodolist(auth, {
      taskId: "task-ver",
      todolistId: first.todolistId,
    });
    expect(loaded?.status).toBe("confirmed");
    expect(loaded?.confirmedBy).toBe("bot-secretary");
  });

  test("owner self-confirm stays refused and submission binding stays strict", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const first = await propose(auth, cfg, [{ title: "一步" }]);
    const selfConfirm = await confirmTodolist(
      auth,
      {
        taskId: "task-ver",
        todolistId: first.todolistId,
        confirmerId: "bot-analyst",
        expectedVersion: first.version,
      },
      { cfg, ...confirmOpts },
    );
    expect(selfConfirm.ok).toBe(false);
    if (!selfConfirm.ok) {
      expect(selfConfirm.reason).toBe("actor_not_confirmer");
    }
    const loaded = await loadExecutorTodolist(auth, {
      taskId: "task-ver",
      todolistId: first.todolistId,
    });
    expect(loaded?.status).toBe("proposed");

    const mismatch = pendingSubmissionMatches({
      currentSubmissionId: "942755ff-d18e-40aa-8252-8c399069d675",
      expectedSubmissionId: "11111111-1111-4111-8111-111111111111",
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.reason).toBe("submission_version_mismatch");
    }
    const missing = pendingSubmissionMatches({
      currentSubmissionId: "942755ff-d18e-40aa-8252-8c399069d675",
      expectedSubmissionId: "",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toBe("expected_submission_id_required");
    }
  });
});
