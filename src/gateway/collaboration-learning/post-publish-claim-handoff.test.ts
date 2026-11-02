/**
 * Positive formal handoff entry path (no manual claimant seed/patch):
 * CEO publishes board with intended=executor → controlled handoff wake
 * schedules that bot → bot claims via production entry → apply → propose
 * plan → legal confirm → mark in_progress → formal submit → accept.
 *
 * Model may be absent/mocked; claim/plan/submit/accept use real entries.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  acceptBoardItemSubmission,
  applyClaim,
  markBoardItemInProgress,
  publishBoardItem,
  submitBoardItemForReview,
} from "../collaboration-dispatch/claim-contract.js";
import { createRoundPolicySnapshot } from "../collaboration-dispatch/round-policy-snapshot.js";
import {
  createRuntimeAuthority,
  type RuntimeAuthority,
} from "../collaboration-dispatch/runtime-authority.js";
import { listWakeEvents } from "../collaboration-dispatch/wake-contract.js";
import {
  P2_LINKED_DELIVERABLE_FIXTURE_BODY,
  seedLinkedTeamDeliverableFixture,
} from "./verify-linked-team-deliverable.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;

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
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const GROUP_ID = "grp_post_publish_handoff";

function flagConfig(root: string): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        claimContract: true,
        wakeContract: true,
        selfAdvance: { mode: "execute", executeGroupAllowlist: [GROUP_ID] },
      },
    },
  } as OpenBotConfig;
}

async function useConfig(): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-post-publish-handoff-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  const cfg = flagConfig(root);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

function authority(cfg: OpenBotConfig): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_post_publish_handoff" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_post_publish_handoff",
    tenant: { tenantId: "tenant-post-publish-handoff", trust: "none" },
    groupId: GROUP_ID,
    profile: "personal_local",
    cfg,
  });
}

describe("post-publish claim handoff (positive entry path)", () => {
  it("CEO publish schedules intended bot; bot claims→plan→confirm→submit→accept", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-post-publish-handoff";
    const ceo = "human:ceo";
    const executor = "bot-exec";
    const reviewer = "bot-reviewer";

    // 1) CEO publishes board with intended=executor (publish ≠ claim).
    const published = await publishBoardItem(
      auth,
      {
        groupId: GROUP_ID,
        taskId,
        remainingWork: "draft handoff markdown",
        acceptanceCriteria: ["has title", "has body"],
        intendedClaimantIds: [executor],
        publishedBy: ceo,
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      throw new Error(published.message);
    }
    expect(published.value.status).toBe("published");
    expect(published.value.claimantId == null || published.value.claimantId === "").toBe(true);

    // 2) Post-publish helper: publisher must NOT become claimant; wake intended.
    const { tryClaimAfterBoardPublish: tryClaim } =
      await import("./try-claim-after-board-publish.js");
    const scheduled = await tryClaim({
      groupId: GROUP_ID,
      taskId,
      item: published.value,
      actorId: ceo,
      authority: auth,
      cfg,
    });
    expect(scheduled.outcome).toBe("scheduled");
    if (scheduled.outcome !== "scheduled") {
      throw new Error(`expected scheduled, got ${JSON.stringify(scheduled)}`);
    }
    expect(scheduled.claimantId).toBeNull();
    expect(scheduled.scheduledClaimantId).toBe(executor);
    expect(scheduled.wakeRecorded).toBe(true);
    expect(scheduled.item.status).toBe("published");
    expect(scheduled.item.claimantId == null || scheduled.item.claimantId === "").toBe(true);

    const wakes = await listWakeEvents(auth, { groupId: GROUP_ID, taskId });
    const handoff = wakes.filter((w) => w.source === "handoff" && w.toAgentIds.includes(executor));
    expect(handoff.length).toBeGreaterThan(0);

    // 3) Intended bot claims via production entry (no manual claimant patch).
    const { claimCollaborationBoardItem } = await import("./claim-contract-entry.js");
    const claimed = await claimCollaborationBoardItem({
      groupId: GROUP_ID,
      taskId,
      itemId: published.value.itemId,
      claimantId: executor,
      actor: executor,
      cfg,
    });
    expect(claimed.status).toBe("claimed");
    expect(claimed.claimantId).toBe(executor);

    // Self-claim path also succeeds when actor IS intended (idempotent already_claimed).
    const selfClaim = await tryClaim({
      groupId: GROUP_ID,
      taskId,
      item: claimed,
      actorId: executor,
      authority: auth,
      cfg,
    });
    expect(selfClaim.outcome).toBe("unchanged");
    if (selfClaim.outcome === "unchanged") {
      expect(selfClaim.reason).toBe("already_claimed");
      expect(selfClaim.claimantId).toBe(executor);
    }

    // 4) apply → propose plan → legal confirm → in_progress.
    const seedTask: Task = {
      taskId,
      groupId: GROUP_ID,
      title: "post publish handoff",
      status: "in_progress",
      ownerMemberId: reviewer,
      assignedMemberIds: [reviewer],
      createdBy: ceo,
      updatedBy: ceo,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const applied = await applyClaim(
      auth,
      { taskId, itemId: published.value.itemId },
      seedTask,
      auth.policy.effective,
      { cfg },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      throw new Error(applied.message);
    }

    const { proposeTodolist, confirmTodolist } =
      await import("../collaboration-dispatch/executor-private-todolist.js");
    const proposed = await proposeTodolist(
      auth,
      {
        boardItemId: published.value.itemId,
        taskId,
        groupId: GROUP_ID,
        ownerMemberId: executor,
        steps: [{ title: "draft handoff md" }],
      },
      { cfg },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      throw new Error(proposed.message);
    }
    const confirmed = await confirmTodolist(
      auth,
      {
        taskId,
        todolistId: proposed.value.todolistId,
        confirmerId: reviewer,
      },
      { cfg, authorizedConfirmerIds: [reviewer] },
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      throw new Error(confirmed.message);
    }

    const started = await markBoardItemInProgress(
      auth,
      {
        taskId,
        itemId: published.value.itemId,
        actorId: executor,
      },
      { cfg },
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      throw new Error(`${started.reason}: ${started.message}`);
    }

    // 5) Formal submit → accept (production entries).
    const seeded = await seedLinkedTeamDeliverableFixture({
      authority: auth,
      taskId,
      deliverableId: "del-post-publish-handoff",
      version: 1,
      content: P2_LINKED_DELIVERABLE_FIXTURE_BODY,
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) {
      throw new Error(seeded.reason);
    }
    const submissionId = randomUUID();
    const submitted = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId: published.value.itemId,
        actorId: executor,
        submissionId,
        artifactVersion: "art-handoff-v1",
        submissionSummary: "# Handoff draft\nbody",
        linkedDeliverableId: seeded.deliverableId,
        linkedDeliverableVersion: seeded.version,
        linkedContentSha256: seeded.contentSha256,
      },
      { cfg, coordinatorBotId: reviewer },
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      throw new Error(submitted.message);
    }

    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: published.value.itemId,
        actorId: reviewer,
        expectedSubmissionId: submissionId,
        reason: "meets acceptance criteria: has title and body",
        checkedAcceptanceCriteria: ["has title", "has body"],
      },
      { cfg },
    );
    expect(accepted.ok, accepted.ok ? "" : `${accepted.reason}: ${accepted.message}`).toBe(true);
    if (!accepted.ok) {
      throw new Error(`${accepted.reason}: ${accepted.message}`);
    }
    expect(accepted.value.status).toBe("accepted");
    expect(accepted.value.claimantId).toBe(executor);
  });
});
