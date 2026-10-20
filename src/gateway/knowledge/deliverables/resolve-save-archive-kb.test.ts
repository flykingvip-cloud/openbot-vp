// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensurePersonalDeliverablesKnowledgeBase,
  ensureTeamDeliverablesKnowledgeBase,
  PERSONAL_DELIVERABLES_KB_TITLE,
  TEAM_DELIVERABLES_KB_TITLE,
} from "../deliverable-folders.js";
import { createKnowledgeBase } from "../knowledge-base-store.js";
import {
  isAutoSaveArchiveKnowledgeBaseId,
  resolveDefaultSaveArchiveKnowledgeBase,
  resolveSaveArchiveKnowledgeBase,
  SaveArchiveKnowledgeBaseError,
} from "./resolve-save-archive-kb.js";

describe("resolveDefaultSaveArchiveKnowledgeBase", () => {
  let storePath = "";

  afterEach(() => {
    if (storePath && fs.existsSync(storePath)) {
      fs.rmSync(storePath);
    }
  });

  it("treats empty/auto/default as auto ids", () => {
    expect(isAutoSaveArchiveKnowledgeBaseId(null)).toBe(true);
    expect(isAutoSaveArchiveKnowledgeBaseId("")).toBe(true);
    expect(isAutoSaveArchiveKnowledgeBaseId("auto")).toBe(true);
    expect(isAutoSaveArchiveKnowledgeBaseId("DEFAULT")).toBe(true);
    expect(isAutoSaveArchiveKnowledgeBaseId("kb_abc")).toBe(false);
  });

  it("defaults to personal deliverables without group", () => {
    storePath = path.join(os.tmpdir(), `kb-resolve-${Date.now()}.json`);
    const resolved = resolveDefaultSaveArchiveKnowledgeBase({
      userId: "user-1",
      storePath,
    });
    expect(resolved.source).toBe("personal_deliverables");
    expect(resolved.knowledgeBase.title).toBe(PERSONAL_DELIVERABLES_KB_TITLE);
  });

  it("defaults to team deliverables for collaboration group", () => {
    storePath = path.join(os.tmpdir(), `kb-resolve-team-${Date.now()}.json`);
    const resolved = resolveDefaultSaveArchiveKnowledgeBase({
      userId: "user-1",
      groupId: "group-xyz",
      storePath,
    });
    expect(resolved.source).toBe("team_deliverables");
    expect(resolved.knowledgeBase.title).toBe(TEAM_DELIVERABLES_KB_TITLE);
  });

  it("rejects when the team deliverables folder is not writable", () => {
    storePath = path.join(os.tmpdir(), `kb-resolve-fallback-${Date.now()}.json`);
    const first = resolveDefaultSaveArchiveKnowledgeBase({
      userId: "owner",
      groupId: "group-xyz",
      tenantId: "tenant-a",
      storePath,
    });
    expect(first.source).toBe("team_deliverables");

    expect(() =>
      resolveDefaultSaveArchiveKnowledgeBase({
        userId: "other",
        groupId: "group-xyz",
        tenantId: "tenant-a",
        storePath,
        canWrite: (kb) => kb.ownerId === "other",
      }),
    ).toThrow(SaveArchiveKnowledgeBaseError);
    expect(() =>
      resolveDefaultSaveArchiveKnowledgeBase({
        userId: "other",
        groupId: "group-xyz",
        tenantId: "tenant-a",
        storePath,
        canWrite: (kb) => kb.ownerId === "other",
      }),
    ).toThrow(/team deliverables/);
  });
});

describe("resolveSaveArchiveKnowledgeBase", () => {
  let storePath = "";

  afterEach(() => {
    if (storePath && fs.existsSync(storePath)) {
      fs.rmSync(storePath);
    }
  });

  it("resolves empty/auto/default to the session-owned reserved folder", () => {
    storePath = path.join(os.tmpdir(), `kb-resolve-save-${Date.now()}.json`);
    for (const knowledgeBaseId of [undefined, "", "auto", "default"]) {
      const personal = resolveSaveArchiveKnowledgeBase({
        userId: "user-1",
        knowledgeBaseId,
        storePath,
      });
      expect(personal.source).toBe("personal_deliverables");
      const team = resolveSaveArchiveKnowledgeBase({
        userId: "user-1",
        groupId: "group-xyz",
        knowledgeBaseId,
        storePath,
      });
      expect(team.source).toBe("team_deliverables");
    }
  });

  it("rejects an explicit ordinary knowledge base", () => {
    storePath = path.join(os.tmpdir(), `kb-resolve-ordinary-${Date.now()}.json`);
    const ordinary = createKnowledgeBase(
      {
        title: "普通知识库",
        ownerId: "user-1",
        visibility: "private",
        backendKind: "personal",
      },
      storePath,
    );
    expect(() =>
      resolveSaveArchiveKnowledgeBase({
        userId: "user-1",
        knowledgeBaseId: ordinary.id,
        storePath,
      }),
    ).toThrow(/personal_deliverables/);
  });

  it("rejects a personal session that explicitly targets 团队成果", () => {
    storePath = path.join(os.tmpdir(), `kb-resolve-cross-personal-${Date.now()}.json`);
    const team = ensureTeamDeliverablesKnowledgeBase({
      ownerId: "user-1",
      storePath,
    });
    expect(() =>
      resolveSaveArchiveKnowledgeBase({
        userId: "user-1",
        knowledgeBaseId: team.id,
        storePath,
      }),
    ).toThrow(/personal_deliverables/);
  });

  it("rejects a collaboration session that explicitly targets 个人成果", () => {
    storePath = path.join(os.tmpdir(), `kb-resolve-cross-team-${Date.now()}.json`);
    const personal = ensurePersonalDeliverablesKnowledgeBase({
      ownerId: "user-1",
      storePath,
    });
    expect(() =>
      resolveSaveArchiveKnowledgeBase({
        userId: "user-1",
        groupId: "group-xyz",
        knowledgeBaseId: personal.id,
        storePath,
      }),
    ).toThrow(/team_deliverables/);
  });
});
