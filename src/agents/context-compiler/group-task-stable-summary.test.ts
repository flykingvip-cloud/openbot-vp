import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskLedgerEntry } from "../../auto-reply/reply/session-continuity.js";
import {
  createTaskContext,
  resolveTaskContextScope,
  updateTaskContext,
} from "../../auto-reply/reply/task-context-store.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import {
  assertNoPrivateRunBagInPublicPayload,
  createCollaborationPrivateRunBag,
} from "../../gateway/collaboration-dispatch/private-run-bag.js";
import { loadContextCandidates } from "./candidates.js";
import {
  buildStableGroupTaskSummaryText,
  isGroupTaskStableSummaryEnabled,
  selectStableGroupTask,
  stableSummaryLooksLikePrivateRunBag,
} from "./group-task-stable-summary.js";

let tempDirs: string[] = [];
const PREV_ENV = process.env.OPENBOT_COLLAB_GROUP_TASK_STABLE_SUMMARY;

afterEach(async () => {
  if (PREV_ENV === undefined) {
    delete process.env.OPENBOT_COLLAB_GROUP_TASK_STABLE_SUMMARY;
  } else {
    process.env.OPENBOT_COLLAB_GROUP_TASK_STABLE_SUMMARY = PREV_ENV;
  }
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-group-task-stable-"));
  tempDirs.push(dir);
  return dir;
}

function makeTask(
  overrides: Partial<TaskLedgerEntry> & Pick<TaskLedgerEntry, "id" | "status">,
): TaskLedgerEntry {
  return {
    id: overrides.id,
    scope: "group",
    owner_id: overrides.owner_id ?? "grp-demo",
    title: overrides.title ?? "Demo task",
    description: overrides.description ?? "",
    status: overrides.status,
    project: overrides.project,
    decisions: overrides.decisions,
    context: overrides.context ?? { key_points: [] },
    artifacts: overrides.artifacts ?? [],
    session_ids: overrides.session_ids,
    last_session_id: overrides.last_session_id ?? "",
    updated_at: overrides.updated_at ?? "2026-10-19T12:00:00.000Z",
    ...(overrides.surface_disposition
      ? { surface_disposition: overrides.surface_disposition }
      : {}),
  };
}

describe("isGroupTaskStableSummaryEnabled", () => {
  it("defaults off", () => {
    delete process.env.OPENBOT_COLLAB_GROUP_TASK_STABLE_SUMMARY;
    expect(isGroupTaskStableSummaryEnabled(undefined)).toBe(false);
    expect(isGroupTaskStableSummaryEnabled({} as OpenBotConfig)).toBe(false);
    expect(
      isGroupTaskStableSummaryEnabled({
        collaboration: { groupTaskStableSummary: false },
      } as OpenBotConfig),
    ).toBe(false);
  });

  it("enables via config or env", () => {
    delete process.env.OPENBOT_COLLAB_GROUP_TASK_STABLE_SUMMARY;
    expect(
      isGroupTaskStableSummaryEnabled({
        collaboration: { groupTaskStableSummary: true },
      } as OpenBotConfig),
    ).toBe(true);
    process.env.OPENBOT_COLLAB_GROUP_TASK_STABLE_SUMMARY = "1";
    expect(isGroupTaskStableSummaryEnabled({} as OpenBotConfig)).toBe(true);
  });
});

describe("selectStableGroupTask", () => {
  it("prefers bound task even when not active", () => {
    const bound = makeTask({
      id: "task_bound",
      status: "done",
      updated_at: "2026-10-18T00:00:00.000Z",
    });
    const newerActive = makeTask({
      id: "task_other",
      status: "active",
      updated_at: "2026-10-19T00:00:00.000Z",
    });
    const selected = selectStableGroupTask({
      tasks: [newerActive, bound],
      boundTaskId: "task_bound",
    });
    expect(selected?.task.id).toBe("task_bound");
    expect(selected?.binding).toBe("bound");
  });

  it("falls back to most recent active, then paused, then recent", () => {
    const done = makeTask({
      id: "task_done",
      status: "done",
      updated_at: "2026-10-19T10:00:00.000Z",
    });
    expect(selectStableGroupTask({ tasks: [done] })?.binding).toBe("fallback-recent");

    const paused = makeTask({
      id: "task_paused",
      status: "paused",
      updated_at: "2026-10-19T09:00:00.000Z",
    });
    expect(selectStableGroupTask({ tasks: [done, paused] })?.task.id).toBe("task_paused");
    expect(selectStableGroupTask({ tasks: [done, paused] })?.binding).toBe("fallback-paused");

    const active = makeTask({
      id: "task_active",
      status: "active",
      updated_at: "2026-10-19T08:00:00.000Z",
    });
    expect(selectStableGroupTask({ tasks: [done, paused, active] })?.task.id).toBe("task_active");
    expect(selectStableGroupTask({ tasks: [done, paused, active] })?.binding).toBe(
      "fallback-active",
    );
  });

  it("returns undefined when ledger empty", () => {
    expect(selectStableGroupTask({ tasks: [], boundTaskId: "missing" })).toBeUndefined();
  });
});

describe("buildStableGroupTaskSummaryText", () => {
  it("includes goal, constraints, decisions, open context, deliverables, owners", () => {
    const text = buildStableGroupTaskSummaryText(
      makeTask({
        id: "task_rich",
        status: "paused",
        title: "银川数贸可行性",
        description: "继续 SWOT",
        project: {
          goals: ["完成 SWOT", "交付预览稿"],
          owner_human: "Campbell",
        },
        context: {
          key_points: ["已确认范围", "待补竞品"],
          constraints: ["不得改正式根", "只用群授权资料"],
        },
        decisions: [{ id: "d1", text: "采用三方对比框架", at: "2026-10-19T01:00:00.000Z" }],
        artifacts: ["art_swot_v1"],
      }),
      "bound",
    );
    expect(text).toContain("Group task summary [bound]");
    expect(text).toContain("Source: group-task-ledger id=task_rich status=paused group=grp-demo");
    expect(text).toContain("Goal: 银川数贸可行性");
    expect(text).toContain("Hard constraints:");
    expect(text).toContain("- 不得改正式根");
    expect(text).toContain("Confirmed decisions:");
    expect(text).toContain("- 采用三方对比框架");
    expect(text).toContain("Open context:");
    expect(text).toContain("- 待补竞品");
    expect(text).toContain("Deliverable refs:");
    expect(text).toContain("- art_swot_v1");
    expect(text).toContain("Owners:");
    expect(text).toContain("- human:Campbell");
    expect(text).toContain("- group:grp-demo");
    expect(text).toContain("injecting stable ledger snapshot");
    expect(stableSummaryLooksLikePrivateRunBag(text)).toBe(false);
    expect(() => assertNoPrivateRunBagInPublicPayload(text)).not.toThrow();
  });
});

describe("loadContextCandidates + groupTaskStableSummary", () => {
  async function seedGroup(params: {
    flagOn: boolean;
    status: "active" | "paused" | "done";
    bind?: boolean;
  }) {
    const workspaceDir = await makeTempDir();
    const collaborationRoot = await makeTempDir();
    const groupId = "grp-stable";
    const cfg = {
      agents: { defaults: { workspace: workspaceDir } },
      collaboration: {
        defaults: { workspace: collaborationRoot },
        groupTaskStableSummary: params.flagOn,
      },
    } satisfies OpenBotConfig;
    const sessionKey = `agent:bot-a:main:space:${groupId}`;
    const sessionEntryBase = {
      sessionId: "sess-group-1",
      updatedAt: Date.now(),
      chatType: "group",
      groupId,
      space: groupId,
    } satisfies SessionEntry;
    const scope = resolveTaskContextScope({
      cfg,
      workspaceDir,
      agentId: "bot-a",
      sessionKey,
      sessionEntry: sessionEntryBase,
    });
    expect(scope.scope).toBe("group");
    await fs.mkdir(scope.rootDir, { recursive: true });
    const task = await createTaskContext({
      scope,
      title: "市场助手正文",
      description: "产出群交付正文",
    });
    await updateTaskContext({
      scope,
      taskId: task.id,
      patch: {
        status: params.status,
        context: {
          key_points: ["用户要可发布正文"],
          constraints: ["不得把私有记忆写入 GROUP_PUBLIC"],
        },
        project: { goals: ["交付正文"], owner_human: "ops" },
        decisions: [
          {
            id: "d-keep-goal",
            text: "继续沿用已确认大纲",
            at: new Date().toISOString(),
          },
        ],
      },
    });
    // Attach a deliverable id via ledger rewrite (no attach API).
    const ledgerPath = path.join(scope.rootDir, "task_ledger.json");
    const ledger = JSON.parse(await fs.readFile(ledgerPath, "utf8")) as {
      items: Array<Record<string, unknown>>;
    };
    ledger.items = ledger.items.map((item) =>
      item.id === task.id ? { ...item, artifacts: ["art_body_v1"] } : item,
    );
    await fs.writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

    const sessionEntry: SessionEntry = params.bind
      ? { ...sessionEntryBase, taskContextId: task.id }
      : sessionEntryBase;
    return { cfg, workspaceDir, sessionKey, sessionEntry, taskId: task.id, scope };
  }

  it("flag-on + active bound group task → non-empty rich summary", async () => {
    const seeded = await seedGroup({ flagOn: true, status: "active", bind: true });
    const candidates = await loadContextCandidates({
      cfg: seeded.cfg,
      workspaceDir: seeded.workspaceDir,
      agentId: "bot-a",
      sessionKey: seeded.sessionKey,
      sessionEntry: seeded.sessionEntry,
    });
    expect(candidates.task).toContain("Group task summary [bound]");
    expect(candidates.task).toContain("Goal: 市场助手正文");
    expect(candidates.task).toContain("Hard constraints:");
    expect(candidates.task).toContain("Deliverable refs:");
    expect(candidates.task).toContain("art_body_v1");
    expect(stableSummaryLooksLikePrivateRunBag(candidates.task)).toBe(false);
  });

  it("flag-on + bound group task no longer active → still non-empty stable summary", async () => {
    const seeded = await seedGroup({ flagOn: true, status: "done", bind: true });
    const candidates = await loadContextCandidates({
      cfg: seeded.cfg,
      workspaceDir: seeded.workspaceDir,
      agentId: "bot-a",
      sessionKey: seeded.sessionKey,
      sessionEntry: seeded.sessionEntry,
    });
    expect(candidates.task.length).toBeGreaterThan(0);
    expect(candidates.task).toContain(`id=${seeded.taskId}`);
    expect(candidates.task).toContain("status=done");
    expect(candidates.task).toContain("Confirmed decisions:");
    expect(candidates.task).toContain("继续沿用已确认大纲");
    expect(candidates.task).toContain("injecting stable ledger snapshot");
  });

  it("skips a bound row the hang-list keep-only already cancelled", () => {
    const cancelled = makeTask({
      id: "task_cancelled",
      status: "active",
      title: "近5年外企在华知识产权",
      surface_disposition: "cancelled",
    });
    const other = makeTask({ id: "task_other", status: "active", title: "别的任务" });
    expect(
      selectStableGroupTask({
        tasks: [cancelled, other],
        boundTaskId: "task_cancelled",
      }),
    ).toBeUndefined();
  });

  it("flag-off + bound done group task → empty (legacy active-only)", async () => {
    const seeded = await seedGroup({ flagOn: false, status: "done", bind: true });
    const candidates = await loadContextCandidates({
      cfg: seeded.cfg,
      workspaceDir: seeded.workspaceDir,
      agentId: "bot-a",
      sessionKey: seeded.sessionKey,
      sessionEntry: seeded.sessionEntry,
    });
    expect(candidates.task).toBe("");
  });

  it("personal 1:1 unchanged when flag off (and when flag on)", async () => {
    const workspaceDir = await makeTempDir();
    for (const flagOn of [false, true]) {
      const cfg = {
        agents: { defaults: { workspace: workspaceDir } },
        collaboration: { groupTaskStableSummary: flagOn },
      } satisfies OpenBotConfig;
      const scope = resolveTaskContextScope({
        cfg,
        workspaceDir,
        agentId: "main",
        sessionKey: "agent:main:main",
      });
      expect(scope.scope).toBe("agent");
      await fs.mkdir(scope.rootDir, { recursive: true });
      const task = await createTaskContext({
        scope,
        title: `个人任务-${flagOn ? "on" : "off"}`,
      });
      await updateTaskContext({ scope, taskId: task.id, patch: { status: "done" } });
      const candidates = await loadContextCandidates({
        cfg,
        workspaceDir,
        agentId: "main",
        sessionKey: "agent:main:main",
        sessionEntry: {
          sessionId: "personal-1",
          updatedAt: Date.now(),
          taskContextId: task.id,
        },
      });
      // Personal stays active-only regardless of the group stable-summary flag.
      expect(candidates.task).toBe("");
    }
  });

  it("does not serialize private run bag into the summary / public payload guard", async () => {
    const seeded = await seedGroup({ flagOn: true, status: "paused", bind: true });
    const candidates = await loadContextCandidates({
      cfg: seeded.cfg,
      workspaceDir: seeded.workspaceDir,
      agentId: "bot-a",
      sessionKey: seeded.sessionKey,
      sessionEntry: seeded.sessionEntry,
    });
    const bag = createCollaborationPrivateRunBag({ agentId: "bot-a" });
    expect(stableSummaryLooksLikePrivateRunBag(candidates.task)).toBe(false);
    expect(() => assertNoPrivateRunBagInPublicPayload(candidates.task)).not.toThrow();
    // Mixing a private bag into a public body must still be rejected by the hard guard.
    expect(() =>
      assertNoPrivateRunBagInPublicPayload(
        { summary: candidates.task, CollaborationPrivateRunBag: bag },
        "GROUP_PUBLIC transcript write",
      ),
    ).toThrow(/GROUP_PUBLIC/);
  });
});
