import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hydrateGroupArtifactsFromManagedMirror } from "./shared.js";

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

describe("hydrateGroupArtifactsFromManagedMirror", () => {
  it("loads profile and members from managed space mirror when runtime root is empty", async () => {
    const stateDir = await makeTempDir("openbot-hydrate-");
    const groupId = "space-market";
    const managedDir = path.join(stateDir, "spaces", groupId);
    await fs.mkdir(managedDir, { recursive: true });
    await fs.writeFile(
      path.join(managedDir, "profile.json"),
      JSON.stringify({
        profile: {
          groupId,
          displayName: "市场研究组",
          ownerUserId: "owner@example.com",
          coordinatorBotId: "bot-2",
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(managedDir, "members.json"),
      JSON.stringify({
        members: [
          {
            memberId: "human:owner@example.com",
            memberKind: "human",
            userId: "owner@example.com",
            name: "Owner",
            governanceRole: "owner",
            status: "active",
          },
          {
            memberId: "bot:bot-2",
            memberKind: "bot",
            agentId: "bot-2",
            name: "市场助手",
            governanceRole: "member",
            status: "active",
          },
        ],
      }),
      "utf8",
    );

    const hydrated = await hydrateGroupArtifactsFromManagedMirror({
      stateDir,
      groupId,
      profile: null,
      members: [],
    });

    expect(hydrated.hydratedFromMirror).toBe(true);
    expect(hydrated.profile?.displayName).toBe("市场研究组");
    expect(hydrated.profile?.ownerUserId).toBe("owner@example.com");
    expect(hydrated.members).toHaveLength(2);
  });
});
