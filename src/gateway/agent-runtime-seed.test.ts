import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-runtime-seed-test-${Date.now()}`);
vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const { __agentRuntimeStoreInternals, listAgents, listBindings } =
  await import("./agent-runtime-store.js");
const { syncRegistryBatch } = await import("./capability-governance-store.js");
const { maybeSeedAgentRuntimeFromPlatformState } = await import("./agent-runtime-seed.js");

function makeManifest(id: string) {
  return {
    id: `urn:openclaw:skill:${id}@1.0.0`,
    kind: "skill",
    version: "1.0.0",
    skillKey: id,
    name: id,
    description: `${id} skill`,
    source: { kind: "bundled", origin: "openclaw-bundled", trustTier: "first-party" },
    risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
  };
}

describe("agent-runtime seed", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    __agentRuntimeStoreInternals.reset();
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("seeds runtime agents and bindings from platform enterprises and registry when store is empty", async () => {
    syncRegistryBatch([makeManifest("github"), makeManifest("weather")]);

    const platformStorePath = path.join(tmpDir, "openbot-platform-auth.json");
    fs.writeFileSync(
      platformStorePath,
      JSON.stringify(
        {
          version: 4,
          secret: "test-secret",
          enterprises: {
            "tenant-a": {
              id: "tenant-a",
              name: "Tenant A",
              status: "paid",
            },
            "tenant-b": {
              id: "tenant-b",
              name: "Tenant B",
              status: "trial",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await maybeSeedAgentRuntimeFromPlatformState({
      cfg: { meta: { lastTouchedVersion: "2026.3.9" } } as never,
      trustedProxy: {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          store: platformStorePath,
        },
      },
    });

    expect(result.seeded).toBe(true);
    expect(result.agentCount).toBe(2);
    expect(result.bindingCount).toBe(4);

    const agents = listAgents({
      lifecycle: null,
      health: null,
      tenantId: null,
      searchQuery: "",
    });
    const bindings = listBindings({
      runtimeAgentId: null,
      capabilityId: null,
      bindingType: null,
      bindingState: null,
      health: null,
    });

    expect(agents).toHaveLength(2);
    expect(bindings).toHaveLength(4);
    expect(fs.existsSync(path.join(tmpDir, "agent-runtime", "store.json"))).toBe(true);
  });

  it("canonicalizes legacy tenant ids during runtime seeding", async () => {
    syncRegistryBatch([makeManifest("github")]);

    const enterpriseTenantsDir = path.join(tmpDir, "enterprise");
    fs.mkdirSync(enterpriseTenantsDir, { recursive: true });
    fs.writeFileSync(
      path.join(enterpriseTenantsDir, "tenants.json"),
      JSON.stringify(
        {
          version: 1,
          tenants: [
            {
              tenantId: "001",
              slug: "upbeyond",
              displayName: "upbeyond",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const platformStorePath = path.join(tmpDir, "openbot-platform-auth.json");
    fs.writeFileSync(
      platformStorePath,
      JSON.stringify(
        {
          version: 4,
          secret: "test-secret",
          enterprises: {
            "upbeyond-91aeea3c": {
              id: "upbeyond-91aeea3c",
              slug: "upbeyond",
              name: "UPBEYOND",
              status: "paid",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await maybeSeedAgentRuntimeFromPlatformState({
      cfg: { meta: { lastTouchedVersion: "2026.3.9" } } as never,
      trustedProxy: {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          store: platformStorePath,
        },
      },
    });

    expect(result.seeded).toBe(true);
    const agents = listAgents({
      lifecycle: null,
      health: null,
      tenantId: null,
      searchQuery: "",
    });
    expect(agents).toHaveLength(1);
    expect(agents[0]?.runtimeAgentId).toBe("rt-001");
    expect(agents[0]?.tenantCoverage).toEqual(["001"]);
  });
});
