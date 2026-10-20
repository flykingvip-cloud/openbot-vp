import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getManagementNodeOwnership,
  setManagementNodeOwnership,
} from "./management-governance-ownership.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("management governance ownership", () => {
  it("persists normalized tenant and employee ownership", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-governance-"));
    tempDirs.push(baseDir);

    await setManagementNodeOwnership(
      " node-a ",
      { tenantId: " tenant-a ", ownerId: " user-a " },
      baseDir,
    );

    await expect(getManagementNodeOwnership("node-a", baseDir)).resolves.toEqual({
      tenantId: "tenant-a",
      ownerId: "user-a",
    });
  });
});
