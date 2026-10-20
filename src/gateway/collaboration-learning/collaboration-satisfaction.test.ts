import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../../config/config.js";
import {
  recordCollaborationSatisfactionBestEffort,
  recordDeliverableTransitionSatisfactionBestEffort,
  recordReviewResolutionSatisfactionBestEffort,
  recordTaskTransitionSatisfactionBestEffort,
  satisfactionPolarityFromReviewVerdict,
} from "./collaboration-satisfaction.js";

describe("satisfactionPolarityFromReviewVerdict", () => {
  it("maps approve/reject/revise verdicts", () => {
    expect(satisfactionPolarityFromReviewVerdict("approve")).toBe(true);
    expect(satisfactionPolarityFromReviewVerdict("reject")).toBe(false);
    expect(satisfactionPolarityFromReviewVerdict("revise")).toBe(false);
    expect(satisfactionPolarityFromReviewVerdict(undefined)).toBeNull();
  });
});

describe("recordCollaborationSatisfactionBestEffort", () => {
  const cleanupDirs: string[] = [];
  let previousStateDir: string | undefined;
  let previousOpenbotConfigPath: string | undefined;
  let previousOpenclawConfigPath: string | undefined;

  afterEach(async () => {
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    if (previousStateDir === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = previousStateDir;
    }
    if (previousOpenbotConfigPath === undefined) {
      delete process.env.OPENBOT_CONFIG_PATH;
    } else {
      process.env.OPENBOT_CONFIG_PATH = previousOpenbotConfigPath;
    }
    if (previousOpenclawConfigPath === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH;
    } else {
      process.env.OPENCLAW_CONFIG_PATH = previousOpenclawConfigPath;
    }
    await Promise.all(
      cleanupDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function withIsolatedGrowthStore<T>(run: () => Promise<T>): Promise<T> {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-collab-satisfaction-"));
    cleanupDirs.push(stateDir);
    previousStateDir = process.env.OPENBOT_STATE_DIR;
    previousOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
    previousOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
    const isolatedConfigPath = path.join(stateDir, "openbot.json");
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENBOT_CONFIG_PATH = isolatedConfigPath;
    process.env.OPENCLAW_CONFIG_PATH = isolatedConfigPath;
    process.env.OPENCLAW_DISABLE_CONFIG_CACHE = "1";
    await fs.writeFile(
      isolatedConfigPath,
      JSON.stringify({
        agents: { list: [{ id: "bot-author" }, { id: "bot-reviewer" }] },
      }),
      "utf8",
    );
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    return run();
  }

  it("records satisfaction for configured agent ids only", async () => {
    await withIsolatedGrowthStore(async () => {
      await recordCollaborationSatisfactionBestEffort({
        agentId: "bot-author",
        positive: true,
      });
      await recordCollaborationSatisfactionBestEffort({
        agentId: "human-operator-1",
        positive: true,
      });
      const { readOperationalMetrics, deriveOperationalSignals } =
        await import("../agent-growth/operational-metrics-store.js");
      const metrics = await readOperationalMetrics(
        (await import("../../config/config.js")).loadConfig(),
        "bot-author",
      );
      expect(metrics?.satisfactionRated).toBe(1);
      expect(metrics?.satisfactionPositive).toBe(1);
      const signals = deriveOperationalSignals(metrics);
      expect(signals?.satisfaction).toBe(1);
      const unknown = await readOperationalMetrics(
        (await import("../../config/config.js")).loadConfig(),
        "human-operator-1",
      );
      expect(unknown?.satisfactionRated).toBe(0);
    });
  });

  it("mirrors known-agent satisfaction into quality ledger when groupId is present", async () => {
    const quality = vi.spyOn(
      await import("../collaboration-ledger/writer.js"),
      "recordCollaborationQualityBestEffort",
    );
    await withIsolatedGrowthStore(async () => {
      await recordCollaborationSatisfactionBestEffort({
        agentId: "bot-author",
        positive: false,
        groupId: "group-1",
        taskId: "task-1",
      });
      expect(quality).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: "group-1",
          event: "human_feedback",
          outcome: "rejected",
          agentId: "bot-author",
          taskId: "task-1",
          humanFeedback: "negative",
        }),
      );
    });
    quality.mockRestore();
  });

  it("records review verdict satisfaction for deliverable author", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-review-satisfaction-"));
    cleanupDirs.push(workspaceDir);

    await withIsolatedGrowthStore(async () => {
      await fs.writeFile(
        process.env.OPENBOT_CONFIG_PATH!,
        JSON.stringify({
          agents: {
            list: [{ id: "bot-author" }, { id: "bot-reviewer" }],
            defaults: { workspace: workspaceDir },
          },
          collaboration: { defaults: { workspace: path.join(workspaceDir, "collab-root") } },
        }),
        "utf8",
      );
      clearRuntimeConfigSnapshot();
      clearConfigCache();

      const { createWorkspaceCollaborationStores } = await import("./shared.js");
      const { objectStorage } = createWorkspaceCollaborationStores();
      await objectStorage.writeObject("group-1", "deliverable", "del-1", {
        deliverableId: "del-1",
        groupId: "group-1",
        status: "submitted",
        submittedBy: "bot-author",
        version: 1,
        createdAtMs: 1,
        updatedAtMs: 1,
      });

      await recordReviewResolutionSatisfactionBestEffort({
        reviewId: "rev-1",
        groupId: "group-1",
        deliverableId: "del-1",
        status: "resolved",
        verdict: "reject",
        reviewerMemberId: "bot-reviewer",
        resolvedBy: "bot-reviewer",
        requestedAtMs: 1,
        createdAtMs: 1,
        updatedAtMs: 2,
      });

      const { readOperationalMetrics } =
        await import("../agent-growth/operational-metrics-store.js");
      const authorMetrics = await readOperationalMetrics(
        (await import("../../config/config.js")).loadConfig(),
        "bot-author",
      );
      const reviewerMetrics = await readOperationalMetrics(
        (await import("../../config/config.js")).loadConfig(),
        "bot-reviewer",
      );
      expect(authorMetrics?.satisfactionRated).toBe(1);
      expect(authorMetrics?.satisfactionPositive).toBe(0);
      expect(reviewerMetrics?.satisfactionRated).toBe(0);
    });
  });

  it("records task transition satisfaction for assigned bot not operator actor", async () => {
    await withIsolatedGrowthStore(async () => {
      await recordTaskTransitionSatisfactionBestEffort({
        taskId: "task-1",
        groupId: "group-1",
        title: "Ship",
        status: "completed",
        assignedMemberIds: ["bot-author"],
        createdBy: "operator-1",
        updatedBy: "operator-1",
        createdAtMs: 1,
        updatedAtMs: 2,
      });
      const { readOperationalMetrics } =
        await import("../agent-growth/operational-metrics-store.js");
      const authorMetrics = await readOperationalMetrics(
        (await import("../../config/config.js")).loadConfig(),
        "bot-author",
      );
      expect(authorMetrics?.satisfactionRated).toBe(1);
      expect(authorMetrics?.satisfactionPositive).toBe(1);
    });
  });

  it("records deliverable transition satisfaction for submittedBy bot", async () => {
    await withIsolatedGrowthStore(async () => {
      await recordDeliverableTransitionSatisfactionBestEffort({
        deliverableId: "del-1",
        groupId: "group-1",
        title: "Deliverable 1",
        status: "approved",
        submittedBy: "bot-author",
        version: 1,
        createdAtMs: 1,
        updatedAtMs: 2,
      });
      const { readOperationalMetrics } =
        await import("../agent-growth/operational-metrics-store.js");
      const authorMetrics = await readOperationalMetrics(
        (await import("../../config/config.js")).loadConfig(),
        "bot-author",
      );
      expect(authorMetrics?.satisfactionRated).toBe(1);
      expect(authorMetrics?.satisfactionPositive).toBe(1);
    });
  });
});

describe("recordReviewResolutionSatisfactionBestEffort", () => {
  it("skips unresolved reviews", async () => {
    const spy = vi.spyOn(
      await import("./collaboration-satisfaction.js"),
      "recordCollaborationSatisfactionBestEffort",
    );
    await recordReviewResolutionSatisfactionBestEffort({
      reviewId: "rev-1",
      groupId: "group-1",
      deliverableId: "del-1",
      status: "submitted",
      verdict: "approve",
      reviewerMemberId: "bot-reviewer",
      requestedAtMs: 1,
      createdAtMs: 1,
      updatedAtMs: 2,
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
