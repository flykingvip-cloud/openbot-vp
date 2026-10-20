import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-skill-asset-save-tool-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const { createSkillAssetSaveTool } = await import("./skill-asset-save-tool.js");
const { listMyAccumulationSkillAssets } =
  await import("../../gateway/personal-skill-asset-scope.js");
const { getSkillRuntimeDefinitionForBinding } =
  await import("../../gateway/skill-lifecycle-store.js");

describe("createSkillAssetSaveTool", () => {
  const workspaceDir = path.join(tmpDir, "workspace");

  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(workspaceDir, "skills", "comment-reply-post"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, "skills", "comment-reply-post", "SKILL.md"),
      `---
name: comment-reply-post
description: Post comments on social feeds with paste-and-verify flow.
---

# Comment reply

Steps go here.
`,
      "utf8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves a workspace SKILL.md into 我的资产 for the signed-in owner", async () => {
    const tool = createSkillAssetSaveTool({
      agentSessionKey: "agent:main:employee:90fed19a",
      gatewayClientUser: "Daniel.HHD@gmail.com",
      workspaceDir,
    });
    const result = await tool.execute("call-1", {
      skillPath: "skills/comment-reply-post/SKILL.md",
      confirmed: true,
    });
    const text = result.content.find((part) => part.type === "text")?.text ?? "";
    expect(text).toContain("我的资产");
    expect(text).toContain("comment-reply-post");
    const listed = listMyAccumulationSkillAssets("daniel.hhd@gmail.com");
    expect(listed.some((entry) => entry.profile.name === "comment-reply-post")).toBe(true);
    const match = listed.find((entry) => entry.profile.name === "comment-reply-post");
    expect(match).toBeTruthy();
    expect(match!.lifecycle).toBe("draft");
    const runtime = getSkillRuntimeDefinitionForBinding(match!.id);
    expect(runtime?.runtimeDefinition.prompts[0]).toContain("paste-and-verify");
  });

  it("rejects unconfirmed saves and path escapes", async () => {
    const tool = createSkillAssetSaveTool({
      gatewayClientUser: "bob@example.com",
      workspaceDir,
    });
    await expect(
      tool.execute("call-2", {
        skillPath: "skills/comment-reply-post/SKILL.md",
        confirmed: false,
      }),
    ).rejects.toThrow(/confirmed/);
    await expect(
      tool.execute("call-3", {
        skillPath: "../etc/passwd",
        confirmed: true,
      }),
    ).rejects.toThrow(/workspace/);
  });
});
