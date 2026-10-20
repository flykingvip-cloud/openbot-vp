import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createOrganizationArtifact,
  createOrganizationDecision,
  readOrganizationArtifacts,
  readOrganizationDecisions,
  readOrganizationOwnerships,
  upsertOrganizationArtifact,
  upsertOrganizationDecision,
  upsertOrganizationOwnership,
  createOrganizationOwnership,
} from "./shared-memory.js";

describe("shared organization memory", () => {
  it("persists decisions, artifacts, and ownerships with organization ownership fields", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-org-memory-"));
    const cfg = { collaboration: { defaults: { workspace: root } } };
    const decision = createOrganizationDecision({
      organizationId: "upbeyond",
      title: "采用公众号AI运营项目锚点",
      createdByAgentId: "main",
      status: "approved",
      taskId: "task-1",
      now: "2026-05-11T00:00:00.000Z",
    });
    await upsertOrganizationDecision({ cfg, workspaceDir: root, decision });

    const artifact = createOrganizationArtifact({
      organizationId: "upbeyond",
      title: "AI热点选题清单",
      artifactType: "doc",
      ownerAgentId: "bot-2",
      createdByAgentId: "bot-2",
      taskId: "task-1",
      uri: "memory://artifact/ai-topics",
      now: "2026-05-11T00:01:00.000Z",
    });
    await upsertOrganizationArtifact({ cfg, workspaceDir: root, artifact });
    await upsertOrganizationOwnership({
      cfg,
      workspaceDir: root,
      ownership: createOrganizationOwnership({
        organizationId: "upbeyond",
        subjectType: "artifact",
        subjectId: artifact.id,
        ownerAgentId: "bot-2",
        assignedByAgentId: "main",
        taskId: "task-1",
      }),
    });

    expect(
      await readOrganizationDecisions({ cfg, workspaceDir: root, organizationId: "upbeyond" }),
    ).toEqual([expect.objectContaining({ title: "采用公众号AI运营项目锚点", status: "approved" })]);
    expect(
      await readOrganizationArtifacts({ cfg, workspaceDir: root, organizationId: "upbeyond" }),
    ).toEqual([
      expect.objectContaining({
        title: "AI热点选题清单",
        ownerAgentId: "bot-2",
        organizationId: "upbeyond",
        taskId: "task-1",
      }),
    ]);
    expect(
      await readOrganizationOwnerships({ cfg, workspaceDir: root, organizationId: "upbeyond" }),
    ).toEqual([
      expect.objectContaining({
        subjectType: "artifact",
        subjectId: artifact.id,
        ownerAgentId: "bot-2",
      }),
    ]);
  });
});
