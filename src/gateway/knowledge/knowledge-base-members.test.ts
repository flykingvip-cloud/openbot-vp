// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  inviteKnowledgeBaseMember,
  KnowledgeBaseMembersError,
  listKnowledgeBaseMembers,
} from "./knowledge-base-members.js";

let storePath: string;

beforeEach(() => {
  storePath = path.join(os.tmpdir(), `kb-members-${randomUUID()}`, "base-members.json");
});

afterEach(() => {
  fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
});

describe("knowledge-base-members", () => {
  it("invites and lists pending members for a knowledge base", () => {
    const member = inviteKnowledgeBaseMember(
      {
        knowledgeBaseId: "kb-1",
        email: "Teammate@Example.com",
        role: "editor",
        invitedByUserId: "user-owner",
      },
      storePath,
    );
    expect(member.email).toBe("teammate@example.com");
    expect(member.role).toBe("editor");
    expect(member.status).toBe("pending");

    const listed = listKnowledgeBaseMembers("kb-1", storePath);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.memberId).toBe(member.memberId);
  });

  it("returns the same pending invite for duplicate email", () => {
    const first = inviteKnowledgeBaseMember(
      {
        knowledgeBaseId: "kb-1",
        email: "dup@example.com",
        invitedByUserId: "user-owner",
      },
      storePath,
    );
    const second = inviteKnowledgeBaseMember(
      {
        knowledgeBaseId: "kb-1",
        email: "dup@example.com",
        invitedByUserId: "user-owner",
      },
      storePath,
    );
    expect(second.memberId).toBe(first.memberId);
    expect(listKnowledgeBaseMembers("kb-1", storePath)).toHaveLength(1);
  });

  it("rejects invalid email", () => {
    expect(() =>
      inviteKnowledgeBaseMember(
        {
          knowledgeBaseId: "kb-1",
          email: "not-an-email",
          invitedByUserId: "user-owner",
        },
        storePath,
      ),
    ).toThrow(KnowledgeBaseMembersError);
  });
});
