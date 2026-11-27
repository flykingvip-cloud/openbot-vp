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

  it("denies a tenant-matched bound robot when the user lacks access", () => {
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
    expect(canReadKnowledgeBase({ knowledgeBase: kb, actor })).toBe(false);
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
  it.each([
    {
      name: "authorized owner and bound agent",
      userId: "owner",
      tenantId: "tenant",
      agentId: "bound",
      allowed: true,
    },
    {
      name: "nonmember with bound agent",
      userId: "other",
      tenantId: "tenant",
      agentId: "bound",
      allowed: false,
    },
    {
      name: "authorized owner with unbound agent",
      userId: "owner",
      tenantId: "tenant",
      agentId: "unbound",
      allowed: false,
    },
    {
      name: "owner in a different tenant",
      userId: "owner",
      tenantId: "other",
      agentId: "bound",
      allowed: false,
    },
    { name: "missing user", userId: null, tenantId: "tenant", agentId: "bound", allowed: false },
    { name: "missing tenant", userId: "owner", tenantId: null, agentId: "bound", allowed: false },
  ])("intersects user and agent access: $name", ({ userId, tenantId, agentId, allowed }) => {
    const kb = createKnowledgeBase(
      {
        title: "Intersection",
        ownerId: "owner",
        tenantId: "tenant",
        visibility: "private",
        robotIds: ["bound"],
      },
      storePath(),
    );
    expect(
      canReadKnowledgeBase({
        knowledgeBase: kb,
        actor: { userId, tenantId, agentId },
        members: [],
      }),
    ).toBe(allowed);
    const revoked = { ...kb, robotIds: [] };
    expect(
      canReadKnowledgeBase({
        knowledgeBase: revoked,
        actor: { userId, tenantId, agentId },
        members: [],
      }),
    ).toBe(false);
  });
  it("uses stable member IDs for agent reads and denies revoked or email-only grants", () => {
    const kb = createKnowledgeBase(
      {
        title: "Stable identity",
        ownerId: "owner",
        tenantId: "tenant",
        visibility: "private",
        robotIds: ["bound"],
      },
      storePath(),
    );
    const actor = {
      userId: "reader",
      tenantId: "tenant",
      agentId: "bound",
      email: "same@example.com",
    };
    const member = {
      memberId: "member",
      knowledgeBaseId: kb.id,
      userId: "reader",
      email: "old@example.com",
      role: "viewer" as const,
      status: "active" as const,
      invitedByUserId: "owner",
      createdAtMs: 1,
    };
    expect(canReadKnowledgeBase({ knowledgeBase: kb, actor, members: [member] })).toBe(true);
    expect(canReadKnowledgeBase({ knowledgeBase: kb, actor, members: [] })).toBe(false);
    expect(
      canReadKnowledgeBase({
        knowledgeBase: kb,
        actor,
        members: [{ ...member, userId: undefined, email: actor.email }],
      }),
    ).toBe(false);
  });
});
