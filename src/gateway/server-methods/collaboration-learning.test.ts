import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let workspaceDir = "";
let previousStateDir: string | undefined;

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: vi.fn(() => "main"),
  resolveAgentWorkspaceDir: vi.fn(() => workspaceDir),
}));

describe("collaboration.learning.snapshot handler", () => {
  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-collab-learning-"));
    previousStateDir = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = workspaceDir;
    // Live stores read stateDir/collaboration/groups (not agent workspace/.openbot/...).
    const groupDir = path.join(
      workspaceDir,
      "collaboration",
      "groups",
      encodeURIComponent("grp_product"),
    );
    await fs.mkdir(groupDir, { recursive: true });
    await fs.writeFile(
      path.join(groupDir, "participations.json"),
      JSON.stringify([
        {
          participationId: "grp_product::bot-main",
          groupId: "grp_product",
          botId: "bot-main",
          governanceRole: "member",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
      ]),
    );
    await fs.writeFile(
      path.join(groupDir, "participation-overlays.json"),
      JSON.stringify([
        {
          participationId: "grp_product::bot-main",
          botId: "bot-main",
          groupId: "grp_product",
          enabledSkills: ["review"],
          updatedAtMs: 3,
        },
      ]),
    );
    await fs.writeFile(
      path.join(groupDir, "capabilities.json"),
      JSON.stringify({
        groupId: "grp_product",
        enabledSkills: ["summarize"],
        updatedAtMs: 4,
      }),
    );
    await fs.writeFile(
      path.join(groupDir, "capsules.json"),
      JSON.stringify({
        capsules: [
          {
            capsuleId: "capsule-1",
            groupId: "grp_product",
            sourceType: "memory",
            sourceIds: ["session-1"],
            capsuleType: "lesson",
            sensitivity: "internal",
            reusability: "exportable",
            confidentialityScope: "tenant",
            status: "approved",
            createdAt: 5,
            updatedAt: 6,
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(groupDir, "projections.json"),
      JSON.stringify({
        projections: [
          {
            projectionId: "projection-1",
            sourceGroupId: "grp_product",
            sourceCapsuleId: "capsule-1",
            sourceParticipationId: "grp_product::bot-main",
            targetBotId: "bot-main",
            projectionType: "personal_transferable",
            transformationRule: "summary",
            sensitivity: "internal",
            confidentialityScope: "tenant",
            requiresApproval: false,
            approvalStatus: "auto_approved",
            eligibilityReason: "ok",
            createdAt: 7,
            updatedAt: 8,
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(groupDir, "learning-assets.json"),
      JSON.stringify({
        assets: [
          {
            assetId: "asset-1",
            botId: "bot-main",
            sourceGroupId: "grp_product",
            sourceCapsuleId: "capsule-1",
            sourceProjectionId: "projection-1",
            assetType: "skill_delta",
            abstractedContent: { capabilities: ["summarize", "review"] },
            applicabilityScope: "tenant",
            confidence: "high",
            sensitivity: "internal",
            confidentialityScope: "tenant",
            transformationRule: "summary",
            status: "active",
            version: 1,
            effectiveFrom: 9,
            createdAt: 9,
            updatedAt: 10,
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(groupDir, "tasks.json"),
      JSON.stringify({
        tasks: [
          {
            taskId: "task-1",
            groupId: "grp_product",
            title: "Ship governance recovery",
            status: "in_progress",
            priority: "high",
            assignedMemberIds: ["bot-main"],
            createdAtMs: 11,
            updatedAtMs: 12,
          },
          {
            taskId: "task-2",
            groupId: "grp_product",
            title: "Prepare rollout review",
            status: "ready",
            createdAtMs: 12,
            updatedAtMs: 12,
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(groupDir, "deliverables.json"),
      JSON.stringify({
        deliverables: [
          {
            deliverableId: "deliverable-1",
            groupId: "grp_product",
            taskId: "task-1",
            title: "Governance implementation report",
            status: "published",
            version: 2,
            publishedAtMs: 13,
            createdAtMs: 11,
            updatedAtMs: 14,
          },
          {
            deliverableId: "deliverable-2",
            groupId: "grp_product",
            taskId: "task-2",
            title: "Rollout checklist",
            status: "in_review",
            version: 1,
            createdAtMs: 12,
            updatedAtMs: 12,
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(groupDir, "reviews.json"),
      JSON.stringify({
        reviews: [
          {
            reviewId: "review-1",
            groupId: "grp_product",
            deliverableId: "deliverable-1",
            taskId: "task-1",
            status: "resolved",
            verdict: "approve",
            reviewerMemberId: "bot-main",
            comments: "Looks good",
            requestedAtMs: 15,
            resolvedAtMs: 16,
            createdAtMs: 15,
            updatedAtMs: 16,
          },
          {
            reviewId: "review-2",
            groupId: "grp_product",
            deliverableId: "deliverable-2",
            taskId: "task-2",
            status: "submitted",
            reviewerMemberId: "bot-main",
            requestedAtMs: 15,
            submittedAtMs: 16,
            createdAtMs: 15,
            updatedAtMs: 16,
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(groupDir, "decisions.json"),
      JSON.stringify([
        {
          decisionId: "decision-1",
          groupId: "grp_product",
          title: "Adopt the recovered governance chain",
          options: [{ optionId: "adopt", title: "Adopt" }],
          selectedOption: "adopt",
          relatedTaskId: "task-1",
          relatedDeliverableId: "deliverable-1",
          status: "finalized",
          createdAt: 17,
          updatedAt: 18,
          finalizedAt: 18,
        },
        {
          decisionId: "decision-2",
          groupId: "grp_product",
          title: "Choose rollout path",
          options: [{ optionId: "gradual", title: "Gradual rollout" }],
          selectedOption: "gradual",
          relatedTaskId: "task-2",
          status: "draft",
          createdAt: 19,
          updatedAt: 19,
        },
      ]),
    );
  });

  afterEach(async () => {
    if (previousStateDir === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = previousStateDir;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
    workspaceDir = "";
  });

  it("loads persisted collaboration learning objects for the active bot scope", async () => {
    const respond = vi.fn();
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");

    await collaborationLearningHandlers["collaboration.learning.snapshot"]({
      req: {} as never,
      params: { groupId: "grp_product", botId: "bot-main" },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        groupId: "grp_product",
        botId: "bot-main",
        groupCapabilities: expect.objectContaining({ enabledSkills: ["summarize"] }),
        groupOperatingState: expect.objectContaining({
          groupId: "grp_product",
          activeContext: expect.objectContaining({
            currentOperatingPhase: "decide",
            currentTaskId: "task-1",
            currentReviewId: "review-2",
            currentDecisionId: "decision-2",
            currentDeliverableId: "deliverable-2",
          }),
          groupMemoryRefs: expect.objectContaining({
            latestCapsuleIds: ["capsule-1"],
          }),
        }),
        participations: expect.arrayContaining([
          expect.objectContaining({ participationId: "grp_product::bot-main" }),
        ]),
        participationOverlays: expect.arrayContaining([
          expect.objectContaining({ botId: "bot-main" }),
        ]),
        capsules: expect.arrayContaining([expect.objectContaining({ capsuleId: "capsule-1" })]),
        projections: expect.arrayContaining([
          expect.objectContaining({ projectionId: "projection-1" }),
        ]),
        assets: expect.arrayContaining([expect.objectContaining({ assetId: "asset-1" })]),
        tasks: expect.arrayContaining([expect.objectContaining({ taskId: "task-1" })]),
        deliverables: expect.arrayContaining([
          expect.objectContaining({ deliverableId: "deliverable-1" }),
        ]),
        reviews: expect.arrayContaining([expect.objectContaining({ reviewId: "review-1" })]),
        decisions: expect.arrayContaining([expect.objectContaining({ decisionId: "decision-1" })]),
      }),
      undefined,
    );
  });

  it("transitions a task through the collaboration handler and persists the new state", async () => {
    const respond = vi.fn();
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");

    await collaborationLearningHandlers["collaboration.task.transition"]({
      req: {} as never,
      params: { groupId: "grp_product", taskId: "task-2", toStatus: "in_progress" },
      respond: respond as never,
      context: {} as never,
      client: { connect: { user: "operator-1" } } as never,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        task: expect.objectContaining({
          taskId: "task-2",
          status: "in_progress",
          updatedBy: "operator-1",
        }),
      }),
      undefined,
    );

    const persisted = JSON.parse(
      await fs.readFile(
        path.join(
          workspaceDir,
          "collaboration",
          "groups",
          encodeURIComponent("grp_product"),
          "tasks.json",
        ),
        "utf8",
      ),
    ) as { tasks: Array<{ taskId: string; status: string }> };
    expect(persisted.tasks.find((entry) => entry.taskId === "task-2")?.status).toBe("in_progress");
    const operatingState = JSON.parse(
      await fs.readFile(
        path.join(
          workspaceDir,
          "collaboration",
          "groups",
          encodeURIComponent("grp_product"),
          "operating-state.json",
        ),
        "utf8",
      ),
    ) as {
      activeContext?: { currentTaskId?: string; currentOperatingPhase?: string };
    };
    expect(operatingState.activeContext?.currentTaskId).toBe("task-2");
    expect(operatingState.activeContext?.currentOperatingPhase).toBe("decide");
  });

  it("refuses retired collaboration.task.handoff shortcut without mutating responsibility", async () => {
    // T09-B1: shortcut is retired. Formal success path is covered by
    // src/gateway/collaboration-learning/handoff-contract-entry.test.ts
    // (proposeHandoff → acceptHandoff → approveHandoff → applyApprovedHandoff).
    const respond = vi.fn();
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");
    const tasksPath = path.join(
      workspaceDir,
      "collaboration",
      "groups",
      encodeURIComponent("grp_product"),
      "tasks.json",
    );
    const beforeRaw = await fs.readFile(tasksPath, "utf8");
    const beforeTasks = JSON.parse(beforeRaw) as {
      tasks: Array<{
        taskId: string;
        ownerMemberId?: string;
        assignedMemberIds?: string[];
        responsibility?: { owner?: string; executors?: string[] };
        handoffs?: unknown[];
        status?: string;
        updatedAtMs?: number;
      }>;
    };
    const beforeTask = beforeTasks.tasks.find((entry) => entry.taskId === "task-2");
    expect(beforeTask).toBeDefined();

    await collaborationLearningHandlers["collaboration.task.handoff"]({
      req: {} as never,
      params: {
        groupId: "grp_product",
        taskId: "task-2",
        from: "operator-1",
        to: "bot-main",
        reason: "need_specialist",
        remainingWork: "Finish the rollout checklist",
        acceptanceCriteria: ["checklist reviewed"],
        completedArtifacts: ["notes.md"],
        assumptions: ["scope unchanged"],
        blockers: [],
      },
      respond: respond as never,
      context: {} as never,
      client: { connect: { user: "operator-1" } } as never,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: expect.stringMatching(
          /proposeHandoff → acceptHandoff → approveHandoff → applyApprovedHandoff/,
        ),
      }),
    );
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toMatch(
      /shortcut is retired and refused/,
    );

    const afterRaw = await fs.readFile(tasksPath, "utf8");
    expect(afterRaw).toBe(beforeRaw);
    const afterTasks = JSON.parse(afterRaw) as typeof beforeTasks;
    const afterTask = afterTasks.tasks.find((entry) => entry.taskId === "task-2");
    expect(afterTask).toEqual(beforeTask);
    expect(afterTask?.ownerMemberId).toBe(beforeTask?.ownerMemberId);
    expect(afterTask?.assignedMemberIds).toEqual(beforeTask?.assignedMemberIds);
    expect(afterTask?.responsibility).toEqual(beforeTask?.responsibility);
    expect(afterTask?.handoffs ?? []).toEqual(beforeTask?.handoffs ?? []);

    const groupDir = path.join(
      workspaceDir,
      "collaboration",
      "groups",
      encodeURIComponent("grp_product"),
    );
    const entries = await fs.readdir(groupDir);
    expect(entries.filter((name) => /handoff/i.test(name))).toEqual([]);
    const wakePath = path.join(groupDir, "wake-events.json");
    await expect(fs.access(wakePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects invalid deliverable transitions", async () => {
    const respond = vi.fn();
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");

    await collaborationLearningHandlers["collaboration.deliverable.transition"]({
      req: {} as never,
      params: { groupId: "grp_product", deliverableId: "deliverable-1", toStatus: "approved" },
      respond: respond as never,
      context: {} as never,
      client: { connect: { user: "operator-1" } } as never,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("Invalid deliverable status transition"),
      }),
    );
  });

  it("transitions review and decision records through dedicated handlers", async () => {
    const respond = vi.fn();
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");

    await collaborationLearningHandlers["collaboration.review.transition"]({
      req: {} as never,
      params: { groupId: "grp_product", reviewId: "review-2", toStatus: "resolved" },
      respond: respond as never,
      context: {} as never,
      client: { connect: { user: "operator-2" } } as never,
      isWebchatConnect: () => false,
    });

    await collaborationLearningHandlers["collaboration.decision.transition"]({
      req: {} as never,
      params: {
        groupId: "grp_product",
        decisionId: "decision-2",
        toStatus: "finalized",
      },
      respond: respond as never,
      context: {} as never,
      client: { connect: { user: "operator-2" } } as never,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenNthCalledWith(
      1,
      true,
      expect.objectContaining({
        review: expect.objectContaining({ reviewId: "review-2", status: "resolved" }),
      }),
      undefined,
    );
    expect(respond).toHaveBeenNthCalledWith(
      2,
      true,
      expect.objectContaining({
        decision: expect.objectContaining({
          decisionId: "decision-2",
          status: "finalized",
          selectedOption: "gradual",
        }),
      }),
      undefined,
    );

    const operatingState = JSON.parse(
      await fs.readFile(
        path.join(
          workspaceDir,
          "collaboration",
          "groups",
          encodeURIComponent("grp_product"),
          "operating-state.json",
        ),
        "utf8",
      ),
    ) as {
      activeContext?: { currentDecisionId?: string | null; currentOperatingPhase?: string | null };
    };
    expect(operatingState.activeContext?.currentDecisionId).toBeNull();
    expect(operatingState.activeContext?.currentOperatingPhase).toBe("review");
  });

  it("updates draft decision content through the dedicated handler", async () => {
    const respond = vi.fn();
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");

    await collaborationLearningHandlers["collaboration.decision.updateDraft"]({
      req: {} as never,
      params: {
        groupId: "grp_product",
        decisionId: "decision-2",
        rationale: "Ship gradually first",
        selectedOption: "gradual",
        options: [
          { optionId: "gradual", title: "Gradual rollout" },
          { optionId: "fast-track", title: "Fast track" },
        ],
      },
      respond: respond as never,
      context: {} as never,
      client: { connect: { user: "operator-3" } } as never,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        decision: expect.objectContaining({
          decisionId: "decision-2",
          status: "draft",
          rationale: "Ship gradually first",
          selectedOption: "gradual",
          options: expect.arrayContaining([
            expect.objectContaining({ optionId: "fast-track", title: "Fast track" }),
          ]),
        }),
      }),
      undefined,
    );

    const persisted = JSON.parse(
      await fs.readFile(
        path.join(
          workspaceDir,
          "collaboration",
          "groups",
          encodeURIComponent("grp_product"),
          "decisions.json",
        ),
        "utf8",
      ),
    ) as Array<{ decisionId: string; rationale?: string; options: Array<{ optionId: string }> }>;
    const decision = persisted.find((entry) => entry.decisionId === "decision-2");
    expect(decision?.rationale).toBe("Ship gradually first");
    expect(decision?.options.map((entry) => entry.optionId)).toEqual(["gradual", "fast-track"]);
  });

  it("rejects draft updates for finalized decisions", async () => {
    const respond = vi.fn();
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");

    await collaborationLearningHandlers["collaboration.decision.updateDraft"]({
      req: {} as never,
      params: {
        groupId: "grp_product",
        decisionId: "decision-1",
        rationale: "Too late to edit",
      },
      respond: respond as never,
      context: {} as never,
      client: { connect: { user: "operator-3" } } as never,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("not editable outside draft status"),
      }),
    );
  });
});

describe("collaboration.task.adminDailySummary params gate", () => {
  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-admin-daily-"));
    previousStateDir = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = workspaceDir;
    const groupDir = path.join(
      workspaceDir,
      "collaboration",
      "groups",
      encodeURIComponent("grp_product"),
    );
    await fs.mkdir(groupDir, { recursive: true });
  });

  afterEach(async () => {
    if (previousStateDir === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = previousStateDir;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
    workspaceDir = "";
  });

  it("rejects invalid params (missing groupId) via respond, not throw", async () => {
    const respond = vi.fn();
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");

    await collaborationLearningHandlers["collaboration.task.adminDailySummary"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("invalid collaboration.task.adminDailySummary params"),
      }),
    );
  });

  it("rejects wrong-shaped params (extra required fields from sibling schema)", async () => {
    const respond = vi.fn();
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");

    // trySelfAdvance shape must not be required; adminDailySummary only needs groupId.
    // Passing actorId alone (no groupId) is still invalid for adminDailySummary.
    await collaborationLearningHandlers["collaboration.task.adminDailySummary"]({
      req: {} as never,
      params: { actorId: "bot:analyst" },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("invalid collaboration.task.adminDailySummary params"),
      }),
    );
  });

  it("accepts valid { groupId } and reaches handler body (not params rejection)", async () => {
    const respond = vi.fn();
    const { collaborationLearningHandlers } = await import("./collaboration-learning.js");

    await collaborationLearningHandlers["collaboration.task.adminDailySummary"]({
      req: {} as never,
      params: { groupId: "grp_product" },
      respond: respond as never,
      context: {} as never,
      client: { connect: { user: "operator-1" } } as never,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledTimes(1);
    const [ok, payload, err] = respond.mock.calls[0] as [boolean, unknown, { message?: string }?];
    // Must not be the params-gate failure (wrong validator / broken respond wiring).
    if (!ok) {
      expect(err?.message ?? "").not.toContain(
        "invalid collaboration.task.adminDailySummary params",
      );
    } else {
      expect(payload).toEqual(expect.objectContaining({ message: expect.any(String) }));
    }
  });
});
