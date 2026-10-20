// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensurePersonalInboxKnowledgeBase,
  findPersonalInboxKnowledgeBase,
  PERSONAL_INBOX_KB_TAG,
  PERSONAL_INBOX_KB_TITLE,
} from "./personal-inbox-knowledge-base.js";

describe("personal inbox knowledge base", () => {
  let storePath = "";

  afterEach(() => {
    if (storePath && fs.existsSync(storePath)) {
      fs.rmSync(storePath);
    }
  });

  it("creates and reuses the default inbox knowledge base", () => {
    storePath = path.join(
      os.tmpdir(),
      `openbot-kb-inbox-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    const created = ensurePersonalInboxKnowledgeBase({
      ownerId: "user-1",
      tenantId: "tenant-a",
      storePath,
    });
    expect(created.title).toBe(PERSONAL_INBOX_KB_TITLE);
    expect(created.tags).toContain(PERSONAL_INBOX_KB_TAG);
    expect(created.ownerId).toBe("user-1");

    const reused = ensurePersonalInboxKnowledgeBase({
      ownerId: "user-1",
      storePath,
    });
    expect(reused.id).toBe(created.id);
    expect(findPersonalInboxKnowledgeBase("user-1", storePath)?.id).toBe(created.id);
  });
});
