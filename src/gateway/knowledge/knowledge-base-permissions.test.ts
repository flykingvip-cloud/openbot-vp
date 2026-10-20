// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpDir } = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-kb-perms-${Math.random().toString(36).slice(2)}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const { inviteKnowledgeBaseMember } = await import("./knowledge-base-members.js");
const {
  buildKnowledgeBasePermissionActor,
  canAdminKnowledgeBase,
  canReadKnowledgeBase,
  canWriteKnowledgeBase,
  resolveAuthorizedKnowledgeBase,
} = await import("./knowledge-base-permissions.js");
const { createKnowledgeBase } = await import("./knowledge-base-store.js");

function storePath(): string {
  return path.join(tmpDir, "knowledge", "bases.json");
}

function membersPath(): string {
  return path.join(tmpDir, "knowledge", "base-members.json");
}

describe("knowledge-base-permissions", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("grants owner full read/write/admin", () => {
    const kb = createKnowledgeBase(
      { title: "Owner KB", ownerId: "user-a", tenantId: null, visibility: "private" },
      storePath(),
    );
    const actor = buildKnowledgeBasePermissionActor({
      context: { userId: "user-a", tenantId: null },
      email: "owner@example.com",
    });
    expect(canReadKnowledgeBase({ knowledgeBase: kb, actor })).toBe(true);
    expect(canWriteKnowledgeBase({ knowledgeBase: kb, actor })).toBe(true);
    expect(canAdminKnowledgeBase({ knowledgeBase: kb, actor })).toBe(true);
  });

  it("grants admin member write and admin but not ownership", () => {
    const kb = createKnowledgeBase(
      { title: "Admin KB", ownerId: "user-a", tenantId: "tenant-1", visibility: "team" },
      storePath(),
    );
    inviteKnowledgeBaseMember(
      {
        knowledgeBaseId: kb.id,
        email: "admin@example.com",
        role: "admin",
        status: "active",
        invitedByUserId: "user-a",
      },
      membersPath(),
    );
    const actor = buildKnowledgeBasePermissionActor({
      context: { userId: "user-b", tenantId: "tenant-1" },
      email: "admin@example.com",
    });
    expect(canReadKnowledgeBase({ knowledgeBase: kb, actor })).toBe(true);
    expect(canWriteKnowledgeBase({ knowledgeBase: kb, actor })).toBe(true);
    expect(canAdminKnowledgeBase({ knowledgeBase: kb, actor })).toBe(true);
    expect(
      resolveAuthorizedKnowledgeBase({
        knowledgeBaseId: kb.id,
        actor,
        permission: "admin",
        storePath: storePath(),
      })?.id,
    ).toBe(kb.id);
  });

  it("grants editor write but not admin", () => {
    const kb = createKnowledgeBase(
      { title: "Team KB", ownerId: "user-a", tenantId: "tenant-1", visibility: "team" },
      storePath(),
    );
    inviteKnowledgeBaseMember(
      {
        knowledgeBaseId: kb.id,
        email: "editor@example.com",
        role: "editor",
        status: "active",
        invitedByUserId: "user-a",
      },
      membersPath(),
    );
    const actor = buildKnowledgeBasePermissionActor({
      context: { userId: "user-b", tenantId: "tenant-1" },
      email: "editor@example.com",
    });
    expect(canReadKnowledgeBase({ knowledgeBase: kb, actor })).toBe(true);
    expect(canWriteKnowledgeBase({ knowledgeBase: kb, actor })).toBe(true);
    expect(canAdminKnowledgeBase({ knowledgeBase: kb, actor })).toBe(false);
    expect(
      resolveAuthorizedKnowledgeBase({
        knowledgeBaseId: kb.id,
        actor,
        permission: "write",
        storePath: storePath(),
      })?.id,
    ).toBe(kb.id);
  });

  it("grants viewer read only", () => {
    const kb = createKnowledgeBase(
      { title: "Shared KB", ownerId: "user-a", tenantId: "tenant-1", visibility: "team" },
      storePath(),
    );
    inviteKnowledgeBaseMember(
      {
        knowledgeBaseId: kb.id,
        email: "viewer@example.com",
        role: "viewer",
        status: "active",
        invitedByUserId: "user-a",
      },
      membersPath(),
    );
    const actor = buildKnowledgeBasePermissionActor({
      context: { userId: "user-c", tenantId: "tenant-1" },
      email: "viewer@example.com",
    });
    expect(canReadKnowledgeBase({ knowledgeBase: kb, actor })).toBe(true);
    expect(canWriteKnowledgeBase({ knowledgeBase: kb, actor })).toBe(false);
    expect(canAdminKnowledgeBase({ knowledgeBase: kb, actor })).toBe(false);
  });

  it("denies pending members write access", () => {
    const kb = createKnowledgeBase(
      { title: "Pending KB", ownerId: "user-a", tenantId: null, visibility: "private" },
      storePath(),
    );
    inviteKnowledgeBaseMember(
      {
        knowledgeBaseId: kb.id,
        email: "pending@example.com",
        role: "editor",
        status: "pending",
        invitedByUserId: "user-a",
      },
      membersPath(),
    );
    const actor = buildKnowledgeBasePermissionActor({
      context: { userId: "user-d", tenantId: null },
      email: "pending@example.com",
    });
    expect(canWriteKnowledgeBase({ knowledgeBase: kb, actor })).toBe(false);
  });

  it("grants read to a tenant-matched robot listed on the knowledge base", () => {
    const kb = createKnowledgeBase(
      {
        title: "Robot KB",
        ownerId: "user-a",
        tenantId: "tenant-1",
        visibility: "private",
        robotIds: ["bot-skill"],
      },
      storePath(),
    );
    const actor = buildKnowledgeBasePermissionActor({
      context: { userId: "user-bot-seat", tenantId: "tenant-1" },
      email: "bot-seat@example.com",
      agentId: "bot-skill",
    });
    expect(canReadKnowledgeBase({ knowledgeBase: kb, actor })).toBe(true);
    expect(canWriteKnowledgeBase({ knowledgeBase: kb, actor })).toBe(false);
  });

  it("does not grant robot read across tenants", () => {
    const kb = createKnowledgeBase(
      {
        title: "Other tenant KB",
        ownerId: "user-a",
        tenantId: "tenant-1",
        visibility: "private",
        robotIds: ["bot-skill"],
      },
      storePath(),
    );
    const actor = buildKnowledgeBasePermissionActor({
      context: { userId: "user-other", tenantId: "tenant-2" },
      email: "other@example.com",
      agentId: "bot-skill",
    });
    expect(canReadKnowledgeBase({ knowledgeBase: kb, actor })).toBe(false);
  });
});
