import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempHomeConfig } from "../config/test-helpers.js";
import type { OpenBotConfig } from "../config/types.openbot.js";
import { readTenantConfig, writeTenantConfigFromRaw } from "./tenant-config-service.js";
import { saveTenantConfigStore, setTenantConfigOverride } from "./tenant-config.js";

const platformDefault = {
  agents: { defaults: { workspace: "/platform" } },
} as unknown as OpenBotConfig;

function workspaceOf(config: unknown): string | undefined {
  const agents = (config as { agents?: { defaults?: { workspace?: string } } }).agents;
  return agents?.defaults?.workspace;
}

describe("tenant-config-service", () => {
  it("writes a tenant override and reads it back, isolated from other tenants", async () => {
    await withTempHomeConfig(platformDefault, async ({ home }) => {
      const storePath = path.join(home, "tenant-config.json");

      const initial = await readTenantConfig({ tenantId: "tenant-a", platformDefault, storePath });
      expect(workspaceOf(initial.config)).toBe("/platform");

      const write = await writeTenantConfigFromRaw({
        tenantId: "tenant-a",
        raw: JSON.stringify({ agents: { defaults: { workspace: "/tenant-a" } } }),
        baseHash: initial.hash,
        platformDefault,
        storePath,
      });
      expect(write.ok).toBe(true);
      if (write.ok) {
        expect(workspaceOf(write.config)).toBe("/tenant-a");
      }

      const reread = await readTenantConfig({ tenantId: "tenant-a", platformDefault, storePath });
      expect(workspaceOf(reread.config)).toBe("/tenant-a");

      // Isolation: tenant-b is unaffected by tenant-a's override.
      const other = await readTenantConfig({ tenantId: "tenant-b", platformDefault, storePath });
      expect(workspaceOf(other.config)).toBe("/platform");
    });
  });

  it("rejects a stale base hash (optimistic concurrency)", async () => {
    await withTempHomeConfig(platformDefault, async ({ home }) => {
      const storePath = path.join(home, "tenant-config.json");
      const initial = await readTenantConfig({ tenantId: "tenant-a", platformDefault, storePath });

      const first = await writeTenantConfigFromRaw({
        tenantId: "tenant-a",
        raw: JSON.stringify({ agents: { defaults: { workspace: "/v1" } } }),
        baseHash: initial.hash,
        platformDefault,
        storePath,
      });
      expect(first.ok).toBe(true);

      // Reusing the now-stale hash must be rejected.
      const stale = await writeTenantConfigFromRaw({
        tenantId: "tenant-a",
        raw: JSON.stringify({ agents: { defaults: { workspace: "/v2" } } }),
        baseHash: initial.hash,
        platformDefault,
        storePath,
      });
      expect(stale.ok).toBe(false);
      if (!stale.ok) {
        expect(stale.code).toBe("BASE_HASH");
      }
    });
  });

  it("rejects invalid JSON5 raw", async () => {
    await withTempHomeConfig(platformDefault, async ({ home }) => {
      const storePath = path.join(home, "tenant-config.json");
      const result = await writeTenantConfigFromRaw({
        tenantId: "tenant-a",
        raw: "{ this is not valid",
        platformDefault,
        storePath,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INVALID");
      }
    });
  });

  it("persists only the minimal delta (platform-equal subtrees omitted)", async () => {
    await withTempHomeConfig(platformDefault, async ({ home }) => {
      const fs = await import("node:fs/promises");
      const storePath = path.join(home, "tenant-config.json");
      await writeTenantConfigFromRaw({
        tenantId: "tenant-a",
        raw: JSON.stringify({ agents: { defaults: { workspace: "/tenant-a" } } }),
        platformDefault,
        storePath,
      });
      const stored = JSON.parse(await fs.readFile(storePath, "utf8")) as {
        tenants: Record<string, { override: Record<string, unknown> }>;
      };
      const override = stored.tenants["tenant-a"]?.override;
      expect(override).toEqual({ agents: { defaults: { workspace: "/tenant-a" } } });
    });
  });

  it("allows a tenant edit that preserves only pre-existing platform validation issues", async () => {
    await withTempHomeConfig(platformDefault, async ({ home }) => {
      const storePath = path.join(home, "tenant-config.json");
      await saveTenantConfigStore(
        setTenantConfigOverride({ version: 1, tenants: {} }, "tenant-a", {
          legacyUnsupportedKey: true,
        }),
        storePath,
      );
      const initial = await readTenantConfig({
        tenantId: "tenant-a",
        platformDefault,
        storePath,
      });
      const current = initial.config as Record<string, unknown>;
      const result = await writeTenantConfigFromRaw({
        tenantId: "tenant-a",
        raw: JSON.stringify({
          ...current,
          channels: { wecom: { enabled: true } },
        }),
        baseHash: initial.hash,
        platformDefault,
        storePath,
      });

      expect(result.ok).toBe(true);
      const reread = await readTenantConfig({
        tenantId: "tenant-a",
        platformDefault,
        storePath,
      });
      expect(reread.config).toMatchObject({ channels: { wecom: { enabled: true } } });
    });
  });

  it("rejects a tenant edit that adds a new validation issue to a legacy-invalid baseline", async () => {
    await withTempHomeConfig(platformDefault, async ({ home }) => {
      const storePath = path.join(home, "tenant-config.json");
      await saveTenantConfigStore(
        setTenantConfigOverride({ version: 1, tenants: {} }, "tenant-a", {
          legacyUnsupportedKey: true,
        }),
        storePath,
      );
      const initial = await readTenantConfig({
        tenantId: "tenant-a",
        platformDefault,
        storePath,
      });
      const result = await writeTenantConfigFromRaw({
        tenantId: "tenant-a",
        raw: JSON.stringify({
          ...(initial.config as Record<string, unknown>),
          anotherUnsupportedKey: true,
        }),
        baseHash: initial.hash,
        platformDefault,
        storePath,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INVALID");
      }
    });
  });
});
