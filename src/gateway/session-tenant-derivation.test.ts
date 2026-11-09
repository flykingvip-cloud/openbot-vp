import { describe, expect, it } from "vitest";
import {
  buildAccountTenantIndex,
  deriveOpenBotTenantForPlatformEnterprise,
  deriveSessionTenant,
} from "./session-tenant-derivation.js";
import { normalizeTenantConfigStore, setTenantConfigOverride } from "./tenant-config.js";

function storeWith(overrides: Array<[string, Record<string, unknown>]>) {
  let store = normalizeTenantConfigStore(null);
  for (const [tenantId, override] of overrides) {
    store = setTenantConfigOverride(store, tenantId, override);
  }
  return store;
}

describe("session tenant derivation (task 2.4)", () => {
  const store = storeWith([
    ["tenant-a", { channels: { telegram: { accounts: [{ id: "tg-a" }, { id: "tg-a2" }] } } }],
    ["tenant-b", { channels: { telegram: { accounts: [{ id: "tg-b" }] } } }],
  ]);
  const index = buildAccountTenantIndex(store);

  it("indexes channel accounts to their owning tenant", () => {
    expect(index.get("telegram:tg-a")).toBe("tenant-a");
    expect(index.get("telegram:tg-a2")).toBe("tenant-a");
    expect(index.get("telegram:tg-b")).toBe("tenant-b");
  });

  it("derives the owning tenant from a session's channel account", () => {
    expect(deriveSessionTenant({ channel: "telegram", lastAccountId: "tg-a" }, index)).toBe(
      "tenant-a",
    );
    expect(deriveSessionTenant({ channel: "telegram", lastAccountId: "tg-b" }, index)).toBe(
      "tenant-b",
    );
  });

  it("returns undefined (platform-global) for unowned accounts or missing channel", () => {
    expect(
      deriveSessionTenant({ channel: "telegram", lastAccountId: "unknown-acct" }, index),
    ).toBeUndefined();
    expect(
      deriveSessionTenant({ channel: undefined, lastAccountId: "tg-a" }, index),
    ).toBeUndefined();
  });

  it("indexes 企业通道 object-map accounts and the observed platform enterprise id", () => {
    const objectStore = storeWith([
      [
        "001",
        {
          channels: {
            feishu: {
              accounts: {
                t_001_default: { platformEnterpriseId: "tenant-key-1" },
              },
            },
          },
        },
      ],
    ]);
    const objectIndex = buildAccountTenantIndex(objectStore);
    expect(
      deriveSessionTenant({ channel: "feishu", lastAccountId: "t_001_default" }, objectIndex),
    ).toBe("001");
    expect(deriveOpenBotTenantForPlatformEnterprise(objectIndex, "feishu", "tenant-key-1")).toBe(
      "001",
    );
    expect(
      deriveOpenBotTenantForPlatformEnterprise(objectIndex, "feishu", "t_001_default"),
    ).toBeUndefined();
  });

  it("empty store yields an empty index (everything platform-global)", () => {
    const emptyIndex = buildAccountTenantIndex(normalizeTenantConfigStore(null));
    expect(emptyIndex.size).toBe(0);
    expect(
      deriveSessionTenant({ channel: "telegram", lastAccountId: "tg-a" }, emptyIndex),
    ).toBeUndefined();
  });
});
