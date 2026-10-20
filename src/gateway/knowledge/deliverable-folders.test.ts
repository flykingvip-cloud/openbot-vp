// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensurePersonalDeliverablesKnowledgeBase,
  ensureReservedDeliverableFolders,
  ensureTeamDeliverablesKnowledgeBase,
  findPersonalDeliverablesKnowledgeBase,
  findTeamDeliverablesKnowledgeBase,
  isReservedDeliverableFolder,
  PERSONAL_DELIVERABLES_KB_TAG,
  PERSONAL_DELIVERABLES_KB_TITLE,
  resolveReservedDeliverableArchiveFolder,
  TEAM_DELIVERABLES_KB_TAG,
  TEAM_DELIVERABLES_KB_TITLE,
} from "./deliverable-folders.js";
import { updateKnowledgeBase } from "./knowledge-base-store.js";

describe("reserved deliverable folders", () => {
  let storePath = "";

  afterEach(() => {
    if (storePath && fs.existsSync(storePath)) {
      fs.rmSync(storePath);
    }
  });

  it("creates and reuses personal / team deliverable folders", () => {
    storePath = path.join(
      os.tmpdir(),
      `openbot-kb-deliverables-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    const created = ensureReservedDeliverableFolders({
      ownerId: "user-1",
      tenantId: "tenant-a",
      storePath,
    });
    expect(created.personal.title).toBe(PERSONAL_DELIVERABLES_KB_TITLE);
    expect(created.personal.visibility).toBe("private");
    expect(created.personal.tags).toContain(PERSONAL_DELIVERABLES_KB_TAG);
    expect(created.team.title).toBe(TEAM_DELIVERABLES_KB_TITLE);
    expect(created.team.visibility).toBe("team");
    expect(created.team.tags).toContain(TEAM_DELIVERABLES_KB_TAG);

    const reused = ensureReservedDeliverableFolders({
      ownerId: "user-1",
      tenantId: "tenant-a",
      storePath,
    });
    expect(reused.personal.id).toBe(created.personal.id);
    expect(reused.team.id).toBe(created.team.id);
    expect(findPersonalDeliverablesKnowledgeBase("user-1", storePath)?.id).toBe(
      created.personal.id,
    );
    expect(
      findTeamDeliverablesKnowledgeBase({
        ownerId: "user-1",
        tenantId: "tenant-a",
        storePath,
      })?.id,
    ).toBe(created.team.id);
  });

  it("restores the reserved title if it was renamed", () => {
    storePath = path.join(os.tmpdir(), `openbot-kb-deliverables-rename-${Date.now()}.json`);
    const created = ensurePersonalDeliverablesKnowledgeBase({
      ownerId: "user-1",
      storePath,
    });
    updateKnowledgeBase(created.id, { title: "被改名" }, storePath);
    const restored = ensurePersonalDeliverablesKnowledgeBase({
      ownerId: "user-1",
      storePath,
    });
    expect(restored.id).toBe(created.id);
    expect(restored.title).toBe(PERSONAL_DELIVERABLES_KB_TITLE);
  });

  it("shares one tenant-level team folder across owners", () => {
    storePath = path.join(os.tmpdir(), `openbot-kb-deliverables-shared-${Date.now()}.json`);
    const first = ensureTeamDeliverablesKnowledgeBase({
      ownerId: "user-1",
      tenantId: "tenant-a",
      storePath,
    });
    const second = ensureTeamDeliverablesKnowledgeBase({
      ownerId: "user-2",
      tenantId: "tenant-a",
      storePath,
    });
    expect(second.id).toBe(first.id);
  });

  it("routes agent output to personal and collaboration to team", () => {
    storePath = path.join(os.tmpdir(), `openbot-kb-deliverables-route-${Date.now()}.json`);
    const personal = resolveReservedDeliverableArchiveFolder({
      ownerId: "user-1",
      sourceType: "agent",
      storePath,
    });
    expect(personal?.kind).toBe("personal_deliverables");
    const team = resolveReservedDeliverableArchiveFolder({
      ownerId: "user-1",
      sourceType: "collaboration",
      storePath,
    });
    expect(team?.kind).toBe("team_deliverables");
    expect(
      resolveReservedDeliverableArchiveFolder({
        ownerId: "user-1",
        sourceType: "enterprise",
        storePath,
      }),
    ).toBeNull();
    expect(isReservedDeliverableFolder(personal?.knowledgeBase)).toBe(true);
  });
});
