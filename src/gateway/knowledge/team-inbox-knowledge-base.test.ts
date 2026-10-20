// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureTeamInboxKnowledgeBase,
  findTeamInboxKnowledgeBase,
  TEAM_INBOX_KB_TAG,
  TEAM_INBOX_KB_TITLE,
  teamInboxGroupTag,
} from "./team-inbox-knowledge-base.js";

describe("team inbox knowledge base", () => {
  let storePath = "";

  afterEach(() => {
    if (storePath && fs.existsSync(storePath)) {
      fs.rmSync(storePath);
    }
  });

  it("creates and reuses the default team inbox per group", () => {
    storePath = path.join(
      os.tmpdir(),
      `openbot-kb-team-inbox-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    const created = ensureTeamInboxKnowledgeBase({
      ownerId: "user-1",
      groupId: "group-abc",
      tenantId: "tenant-a",
      storePath,
    });
    expect(created.title).toBe(TEAM_INBOX_KB_TITLE);
    expect(created.visibility).toBe("team");
    expect(created.tags).toContain(TEAM_INBOX_KB_TAG);
    expect(created.tags).toContain(teamInboxGroupTag("group-abc"));

    const reused = ensureTeamInboxKnowledgeBase({
      ownerId: "user-2",
      groupId: "group-abc",
      storePath,
    });
    expect(reused.id).toBe(created.id);
    expect(findTeamInboxKnowledgeBase("group-abc", storePath)?.id).toBe(created.id);
  });
});
