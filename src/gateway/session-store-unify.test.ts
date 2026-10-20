/**
 * Session-store unification: one conversation-following store; ownership on the
 * record (tenant/user/bot), never path segments; ownership change does not move
 * files; legacy tenant paths remain readable for merge.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStorePath } from "../config/sessions.js";
import type { OpenBotConfig } from "../config/types.js";

const { loadConfigMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
}));
vi.mock("../config/config.js", () => ({ loadConfig: loadConfigMock }));
vi.mock("./platform-auth.js", () => ({
  resolvePlatformAuthConfig: () => ({ enabled: true }),
  loadPlatformAuthStore: async () => ({}),
  findUserByEmail: () => ({ id: "u1", email: "a@acme.com" }),
  findUserById: () => ({ id: "u1", email: "a@acme.com" }),
  findMembershipByUserId: () => ({ enterpriseId: "acme" }),
}));

import type { GatewayClient } from "./server-methods/types.js";
import {
  buildSessionStorePathResolver,
  sessionOwnershipFromTenantContext,
  updateSessionStoreOwnership,
} from "./tenant-context.js";

function client(partial: Partial<GatewayClient> = {}): GatewayClient {
  return {
    connect: {} as never,
    user: "a@acme.com",
    sessionDomain: "employee",
    ...partial,
  } as GatewayClient;
}

describe("session-store unification", () => {
  const dirs: string[] = [];
  const managedCfg = { data: { mode: "managed" }, session: {} } as OpenBotConfig;

  afterEach(async () => {
    delete process.env.OPENBOT_MULTITENANT;
    delete process.env.OPENBOT_STATE_DIR;
    delete process.env.OPENBOT_TENANTS_ROOT;
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("resolves one store path regardless of tenant/user client", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ssu-path-"));
    dirs.push(stateDir);
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENBOT_MULTITENANT = "1";
    loadConfigMock.mockReturnValue(managedCfg);

    const resolveA = await buildSessionStorePathResolver(
      client({ user: "a@acme.com", sessionDomain: "employee" }),
      managedCfg,
    );
    const resolveB = await buildSessionStorePathResolver(
      client({ user: "b@other.com", sessionDomain: "enterprise", sessionEnterpriseId: "globex" }),
      managedCfg,
    );
    const pathA = resolveA("panda");
    const pathB = resolveB("panda");
    const expected = resolveStorePath(undefined, { agentId: "panda" });
    expect(pathA).toBe(expected);
    expect(pathB).toBe(expected);
    expect(pathA).toBe(path.join(stateDir, "agents", "panda", "sessions", "sessions.json"));
    expect(pathA).not.toContain(`${path.sep}tenants${path.sep}`);
    expect(pathA).not.toContain(`${path.sep}users${path.sep}`);
  });

  it("ownership change updates metadata only and does not move files", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ssu-own-"));
    dirs.push(stateDir);
    process.env.OPENBOT_STATE_DIR = stateDir;
    const storePath = path.join(stateDir, "agents", "panda", "sessions", "sessions.json");
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    const transcript = path.join(path.dirname(storePath), "sess-1.jsonl");
    await fs.writeFile(transcript, '{"message":{"role":"user","content":"hi"}}\n', "utf8");
    const sessionKey = "agent:panda:main";
    await fs.writeFile(
      storePath,
      JSON.stringify({
        [sessionKey]: {
          sessionId: "sess-1",
          updatedAt: 1_000,
          sessionFile: transcript,
          ownerTenantId: "acme",
          ownerUserId: "u-old",
          ownerBotId: "panda",
        },
      }),
      "utf8",
    );

    const beforeStat = await fs.stat(transcript);
    await updateSessionStoreOwnership({
      storePath,
      sessionKey,
      ownership: sessionOwnershipFromTenantContext(
        { tenantId: "globex", userId: "u-new", domain: "employee" },
        "panda",
      ),
    });

    const afterStat = await fs.stat(transcript);
    expect(afterStat.ino).toBe(beforeStat.ino);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
    // Store path unchanged.
    expect(await fs.access(storePath).then(() => true)).toBe(true);
    const store = JSON.parse(await fs.readFile(storePath, "utf8")) as Record<
      string,
      { ownerTenantId?: string; ownerUserId?: string; ownerBotId?: string; sessionFile?: string }
    >;
    expect(store[sessionKey]?.ownerTenantId).toBe("globex");
    expect(store[sessionKey]?.ownerUserId).toBe("u-new");
    expect(store[sessionKey]?.ownerBotId).toBe("panda");
    expect(store[sessionKey]?.sessionFile).toBe(transcript);
    // No tenant-scoped copy created.
    const tenantsProbe = path.join(stateDir, "tenants");
    await expect(fs.access(tenantsProbe)).rejects.toThrow();
  });
});
