import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCollaborationQmdCollectionsSync } from "./memory-index-paths.js";

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

describe("memory index paths", () => {
  it("builds qmd collections from collaboration group memory dirs", async () => {
    const collaborationRoot = await makeTempDir("openbot-collab-index-");
    const groupId = "grp-index-test";
    const memoryDir = path.join(collaborationRoot, "groups", groupId, "memory");
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(path.join(memoryDir, "SHARED_MEMORY.md"), "# shared\n", "utf8");

    const cfg = {
      agents: { defaults: { workspace: await makeTempDir("openbot-collab-ws-") } },
      collaboration: { defaults: { workspace: collaborationRoot } },
    };

    const existing = new Set<string>();
    const collections = resolveCollaborationQmdCollectionsSync({
      cfg,
      agentId: "main",
      existingNames: existing,
      scopeCollectionBase: (base, agentId) => `${agentId}-${base}`,
      ensureUniqueName: (base, names) => {
        let candidate = base;
        let index = 1;
        while (names.has(candidate)) {
          candidate = `${base}-${index++}`;
        }
        return candidate;
      },
    });

    expect(collections).toHaveLength(1);
    expect(collections[0]?.path).toBe(memoryDir);
    expect(collections[0]?.pattern).toBe("**/*.md");
  });
});
