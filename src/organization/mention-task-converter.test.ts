import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { convert } from "./mention-task-converter.js";
import type { MentionMetadata } from "./mention-types.js";
import { readOrganizationTaskAssignments } from "./task-assignment.js";

function mention(): MentionMetadata {
  return {
    mention_id: "mention-1",
    agentId: "agent-owner",
    displayName: "Owner",
    offset: 0,
    length: 6,
  };
}

describe("TaskConverter", () => {
  it("requires confirmation before creating a task", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-mention-task-"));

    await expect(
      convert({
        cfg: { collaboration: { defaults: { workspace: root } } },
        workspaceDir: root,
        organizationId: "org-1",
        mention: mention(),
        messageText: "@Owner please finish this",
        sourceAgentId: "agent-source",
      }),
    ).rejects.toThrow("requires confirmation");
  });

  it("creates a task assignment linked to the mention id after confirmation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-mention-task-"));
    const cfg = { collaboration: { defaults: { workspace: root } } };

    const result = await convert({
      cfg,
      workspaceDir: root,
      organizationId: "org-1",
      mention: mention(),
      messageText: "@Owner please finish this",
      sourceAgentId: "agent-source",
      confirmedBy: "user",
      now: "2026-05-12T00:00:00.000Z",
    });

    expect(result).toMatchObject({
      mention_id: "mention-1",
      linked_task_id: result.assignment.id,
    });
    expect(result.assignment.notes).toContain("mention-1");
    expect(
      await readOrganizationTaskAssignments({
        cfg,
        workspaceDir: root,
        organizationId: "org-1",
      }),
    ).toEqual([result.assignment]);
  });
});
