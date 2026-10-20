import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGroupFileStore, createWorkspaceGroupStoreFunctions } from "./shared.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("loadGroupMembers", () => {
  it("prefers members.json over stale embedded profile members", async () => {
    const stateDir = await makeTempDir("openbot-load-members-");
    const groupRootDir = path.join(stateDir, "groups");
    const groupId = "grp-market";
    const fileStore = createGroupFileStore(groupRootDir);
    const { loadGroupMembers, saveGroupMembers } = createWorkspaceGroupStoreFunctions(
      fileStore,
      stateDir,
      groupRootDir,
    );

    await fileStore.writeGroupFile({
      groupId,
      filename: "profile.json",
      data: {
        id: groupId,
        name: "市场研究组",
        groupId,
        displayName: "市场研究组",
        createdAtMs: 1,
        updatedAtMs: 1,
        members: {
          humans: [{ userId: "owner@example.com", name: "Owner", role: "owner" }],
          bots: [],
        },
      },
    });

    await saveGroupMembers(groupId, [
      {
        memberId: "human:owner@example.com",
        memberKind: "human",
        userId: "owner@example.com",
        name: "Owner",
        governanceRole: "owner",
        status: "active",
        updatedAtMs: 2,
      },
      {
        memberId: "human:elle",
        memberKind: "human",
        userId: "elle",
        name: "elle",
        governanceRole: "member",
        status: "active",
        updatedAtMs: 2,
      },
    ]);

    const members = await loadGroupMembers(groupId);
    expect(members).toHaveLength(2);
    expect(members.some((entry) => entry.userId === "elle")).toBe(true);
  });
});
