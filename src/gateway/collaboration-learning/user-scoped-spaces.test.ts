import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../../config/config.js";
import { listGatewayCollaborationSpaces } from "./space-store.js";

let tempDirs: string[] = [];
let previousEnv: Record<string, string | undefined> = {};

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  previousEnv = {};
  clearConfigCache();
  clearRuntimeConfigSnapshot();
});

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("listGatewayCollaborationSpaces user-scoped union", () => {
  it("includes user-scoped owned groups when the tenant catalog is a different root", async () => {
    const stateDir = await makeTempDir("openbot-spaces-state-");
    const workspaceDir = await makeTempDir("openbot-spaces-ws-");
    const tenantCatalog = await makeTempDir("openbot-spaces-tenant-");
    previousEnv = {
      OPENBOT_STATE_DIR: process.env.OPENBOT_STATE_DIR,
      OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
      OPENBOT_CONFIG_PATH: process.env.OPENBOT_CONFIG_PATH,
    };
    const isolatedConfigPath = path.join(stateDir, "openbot.json");
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENCLAW_CONFIG_PATH = isolatedConfigPath;
    process.env.OPENBOT_CONFIG_PATH = isolatedConfigPath;
    await fs.mkdir(path.dirname(isolatedConfigPath), { recursive: true });
    await fs.writeFile(
      isolatedConfigPath,
      JSON.stringify({
        agents: { defaults: { workspace: workspaceDir } },
        collaboration: { defaults: { workspace: tenantCatalog } },
      }),
      "utf8",
    );
    clearConfigCache();
    clearRuntimeConfigSnapshot();

    const tenantGroupId = "grp-hrqb-contingency";
    const userGroupId = "grp-glen-owned";
    const tenantGroupDir = path.join(tenantCatalog, "groups", encodeURIComponent(tenantGroupId));
    const userGroupDir = path.join(
      workspaceDir,
      ".openbot",
      "collaboration",
      "groups",
      encodeURIComponent(userGroupId),
    );
    await fs.mkdir(tenantGroupDir, { recursive: true });
    await fs.mkdir(userGroupDir, { recursive: true });
    await fs.writeFile(
      path.join(tenantGroupDir, "profile.json"),
      JSON.stringify({
        groupId: tenantGroupId,
        groupCode: tenantGroupId,
        displayName: "权变管理专家",
        ownerUserId: "other-user",
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(tenantGroupDir, "members.json"),
      JSON.stringify([
        { memberKind: "human", userId: "other-user", status: "active", name: "Other" },
      ]),
      "utf8",
    );
    await fs.writeFile(
      path.join(userGroupDir, "profile.json"),
      JSON.stringify({
        groupId: userGroupId,
        groupCode: userGroupId,
        displayName: "Glen owned space",
        ownerUserId: "glen-user",
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(userGroupDir, "members.json"),
      JSON.stringify([
        { memberKind: "human", userId: "glen-user", status: "active", name: "Glen" },
      ]),
      "utf8",
    );

    const listed = await listGatewayCollaborationSpaces();
    const ids = listed.spaces.map((space) => space.groupId).toSorted();
    expect(ids).toContain(tenantGroupId);
    expect(ids).toContain(userGroupId);
  });
});
