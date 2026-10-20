import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readOrganizationPresence, upsertOrganizationPresence } from "./presence.js";

describe("organization presence", () => {
  it("persists current agent presence in organization memory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-org-presence-"));
    const cfg = { collaboration: { defaults: { workspace: root } } };

    await upsertOrganizationPresence({
      cfg,
      workspaceDir: root,
      organizationId: "upbeyond",
      presence: {
        agentId: "bot-2",
        online: true,
        lastActiveAt: "2026-05-11T00:03:00.000Z",
        currentTask: "文章质量审核",
      },
    });

    await upsertOrganizationPresence({
      cfg,
      workspaceDir: root,
      organizationId: "upbeyond",
      presence: {
        agentId: "bot-2",
        online: false,
        lastActiveAt: "2026-05-11T00:04:00.000Z",
      },
    });

    expect(
      await readOrganizationPresence({
        cfg,
        workspaceDir: root,
        organizationId: "upbeyond",
      }),
    ).toEqual([
      {
        agentId: "bot-2",
        online: false,
        lastActiveAt: "2026-05-11T00:04:00.000Z",
      },
    ]);
  });
});
