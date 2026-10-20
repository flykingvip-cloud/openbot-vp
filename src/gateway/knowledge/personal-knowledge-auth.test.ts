import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-personal-auth-${Date.now()}`);
vi.mock("../../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const { saveSkillAsset } = await import("../skill-lifecycle-store.js");
const { authorizePersonalKnowledgeObjectAccess, PersonalKnowledgeAuthError } =
  await import("./personal-knowledge-auth.js");
const { personalObjectId } = await import("./personal-mutations.js");
const { attachDocumentToKnowledgeBase, createKnowledgeBase, getKnowledgeBase } =
  await import("./knowledge-base-store.js");

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "knowledge"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

describe("personal knowledge object authorization", () => {
  beforeEach(() => {
    cleanStore();
  });

  afterEach(() => {
    cleanStore();
  });

  it("allows the owner user and denies a different user", () => {
    const saved = saveSkillAsset({
      ownerUserId: "user-owner",
      profile: {
        name: "note",
        summary: "private note",
        assetType: "knowledge",
        tags: [],
        visibility: "private",
      },
    });
    const objectId = personalObjectId(saved.skillId);

    expect(authorizePersonalKnowledgeObjectAccess({ objectId, userId: "user-owner" }).skillId).toBe(
      saved.skillId,
    );

    expect(() =>
      authorizePersonalKnowledgeObjectAccess({ objectId, userId: "user-other" }),
    ).toThrow(PersonalKnowledgeAuthError);
  });

  it("requires authentication", () => {
    const saved = saveSkillAsset({
      ownerUserId: "user-owner",
      profile: {
        name: "note",
        summary: "private note",
        assetType: "knowledge",
        tags: [],
        visibility: "private",
      },
    });
    expect(() =>
      authorizePersonalKnowledgeObjectAccess({
        objectId: personalObjectId(saved.skillId),
        userId: null,
      }),
    ).toThrow(/authenticated user required/);
  });

  it("does not grant knowledge-base access by attaching a skill asset", () => {
    const saved = saveSkillAsset({
      profile: {
        name: "legacy",
        summary: "legacy doc",
        assetType: "knowledge",
        tags: [],
        visibility: "private",
      },
    });
    const kb = createKnowledgeBase({
      title: "mine",
      ownerId: "user-owner",
      visibility: "private",
      backendKind: "personal",
    });
    attachDocumentToKnowledgeBase(kb.id, saved.skillId);
    const objectId = personalObjectId(saved.skillId);
    expect(getKnowledgeBase(kb.id)?.documentIds).toEqual([]);
    expect(() =>
      authorizePersonalKnowledgeObjectAccess({ objectId, userId: "user-owner" }),
    ).toThrow(PersonalKnowledgeAuthError);
  });
});
