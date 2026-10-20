import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  diffTenantOverride,
  getTenantConfigOverride,
  normalizeTenantConfigStore,
  resolveConfigForTenant,
  setTenantConfigOverride,
  type TenantConfigStore,
} from "./tenant-config.js";

function emptyStore(): TenantConfigStore {
  return normalizeTenantConfigStore(null);
}

const platformDefault: OpenBotConfig = {
  models: {
    providers: {
      shared: { baseUrl: "https://platform.example/v1", models: [] },
    },
  },
  channels: {
    telegram: { accounts: [{ id: "platform", botToken: "platform-token" }] },
  },
} as unknown as OpenBotConfig;

describe("tenant-config store", () => {
  it("normalizes a null store to an empty keyed map", () => {
    const store = emptyStore();
    expect(store.tenants).toEqual({});
    expect(store.version).toBeGreaterThan(0);
  });

  it("upserts overrides without mutating the input store or other tenants", () => {
    const base = emptyStore();
    const withA = setTenantConfigOverride(base, "tenant-a", { models: { providers: {} } });
    const withB = setTenantConfigOverride(withA, "tenant-b", { channels: {} });

    // input store untouched (pure)
    expect(base.tenants).toEqual({});
    // tenant-a record preserved when adding tenant-b
    expect(getTenantConfigOverride(withB, "tenant-a")).toEqual({ models: { providers: {} } });
    expect(getTenantConfigOverride(withB, "tenant-b")).toEqual({ channels: {} });
  });

  it("canonicalizes tenant ids on read and write", () => {
    const store = setTenantConfigOverride(emptyStore(), "  Tenant-A  ", { note: 1 });
    // trimmed/canonicalized lookups hit the same record
    expect(getTenantConfigOverride(store, "Tenant-A")).toEqual({ note: 1 });
    expect(getTenantConfigOverride(store, "  Tenant-A")).toEqual({ note: 1 });
  });

  it("round-trips through normalize (persist shape)", () => {
    const store = setTenantConfigOverride(emptyStore(), "tenant-a", { channels: { x: 1 } });
    const reloaded = normalizeTenantConfigStore(JSON.parse(JSON.stringify(store)));
    expect(getTenantConfigOverride(reloaded, "tenant-a")).toEqual({ channels: { x: 1 } });
  });
});

describe("resolveConfigForTenant", () => {
  it("returns the platform default unchanged when there is no override", () => {
    expect(resolveConfigForTenant({ platformDefault, override: null })).toBe(platformDefault);
    expect(resolveConfigForTenant({ platformDefault, override: {} })).toBe(platformDefault);
  });

  it("layers a tenant credential override onto the platform default", () => {
    const resolved = resolveConfigForTenant({
      platformDefault,
      override: {
        channels: { telegram: { accounts: [{ id: "platform", botToken: "tenant-a-token" }] } },
      },
    });
    // tenant token wins for the matching account id (merge-by-id)
    expect(resolved.channels?.telegram?.accounts?.[0]).toMatchObject({
      id: "platform",
      botToken: "tenant-a-token",
    });
    // unrelated platform config preserved
    expect((resolved.models?.providers as Record<string, unknown>)?.shared).toBeDefined();
  });

  // Property 1 (design.md): config isolation — reading tenant A never returns tenant B.
  it("Property: cross-tenant read intersection is empty for distinct credentials", () => {
    let store = emptyStore();
    store = setTenantConfigOverride(store, "tenant-a", {
      channels: { telegram: { accounts: [{ id: "platform", botToken: "secret-A" }] } },
    });
    store = setTenantConfigOverride(store, "tenant-b", {
      channels: { telegram: { accounts: [{ id: "platform", botToken: "secret-B" }] } },
    });

    const a = resolveConfigForTenant({
      platformDefault,
      override: getTenantConfigOverride(store, "tenant-a"),
    });
    const b = resolveConfigForTenant({
      platformDefault,
      override: getTenantConfigOverride(store, "tenant-b"),
    });

    const aToken = a.channels?.telegram?.accounts?.[0]?.botToken;
    const bToken = b.channels?.telegram?.accounts?.[0]?.botToken;
    expect(aToken).toBe("secret-A");
    expect(bToken).toBe("secret-B");
    expect(aToken).not.toBe(bToken);
    expect(JSON.stringify(a)).not.toContain("secret-B");
    expect(JSON.stringify(b)).not.toContain("secret-A");
  });

  // Property 2 (design.md): merge idempotency.
  it("Property: merge is idempotent (resolve(resolve(d,o),o) === resolve(d,o))", () => {
    const override = {
      channels: { telegram: { accounts: [{ id: "platform", botToken: "tok" }] } },
      models: { providers: { extra: { baseUrl: "https://t.example/v1", models: [] } } },
    };
    const once = resolveConfigForTenant({ platformDefault, override });
    const twice = resolveConfigForTenant({ platformDefault: once, override });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe("diffTenantOverride", () => {
  it("round-trips: resolve(default, diff(default, tenantConfig)) === tenantConfig", () => {
    const tenantConfig = {
      ...platformDefault,
      channels: {
        telegram: { accounts: [{ id: "tenant-only", botToken: "tenant-token" }] },
      },
    } as unknown as OpenBotConfig;
    const override = diffTenantOverride(platformDefault, tenantConfig);
    const resolved = resolveConfigForTenant({ platformDefault, override });
    expect(JSON.stringify(resolved)).toBe(JSON.stringify(tenantConfig));
  });

  it("produces a minimal delta (unchanged subtrees omitted)", () => {
    const tenantConfig = {
      ...platformDefault,
      channels: {
        telegram: { accounts: [{ id: "platform", botToken: "changed" }] },
      },
    } as unknown as OpenBotConfig;
    const override = diffTenantOverride(platformDefault, tenantConfig);
    // models unchanged → not present in the delta
    expect(override.models).toBeUndefined();
    expect(override.channels).toBeDefined();
  });
});
