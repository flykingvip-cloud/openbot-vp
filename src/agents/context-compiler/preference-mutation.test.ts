import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyPreferenceMutation } from "./preference-mutation.js";
import { readUserProfileStore } from "./user-profile-store.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function makeWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-user-profile-"));
  tempDirs.push(dir);
  return dir;
}

describe("preference mutation store", () => {
  it("upserts with source/version and is idempotent on sourceMessageId", async () => {
    const workspaceDir = await makeWorkspace();
    const first = await applyPreferenceMutation({
      workspaceDir,
      text: "以后叫我老大",
      sourceMessageId: "run-1",
    });
    const replay = await applyPreferenceMutation({
      workspaceDir,
      text: "以后叫我老大",
      sourceMessageId: "run-1",
    });
    const replacement = await applyPreferenceMutation({
      workspaceDir,
      text: "以后别叫我老大了，叫我老板",
      sourceMessageId: "run-2",
    });

    expect(first).not.toBe("idempotent");
    expect(first).not.toBeNull();
    expect(replay).toBe("idempotent");
    expect(replacement).toMatchObject({
      key: "preferred_address",
      value: "老板",
      version: 2,
      previousValue: "老大",
      sourceMessageId: "run-2",
    });

    const store = await readUserProfileStore(workspaceDir);
    expect(store.appliedSourceMessageIds).toEqual(["run-1", "run-2"]);
    expect(store.entries.preferred_address?.value).toBe("老板");
  });
});
