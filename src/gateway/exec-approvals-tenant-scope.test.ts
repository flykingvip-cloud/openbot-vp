// @vitest-environment node
// Feature: ops-decommission 2.8c — 企业端 exec 审批治理走 tenant-scoped config，
// 服务端跨租户不可见。渠道 execApprovals 子树随租户覆盖隔离（不在全局文件做假隔离）。
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  diffTenantOverride,
  resolveConfigForTenant,
  setTenantConfigOverride,
  getTenantConfigOverride,
  normalizeTenantConfigStore,
  type TenantConfigStore,
} from "./tenant-config.js";

const platformDefault = {
  channels: {
    telegram: {
      // 平台默认不含任何租户级 exec 审批策略。
      accounts: {},
    },
  },
} as unknown as OpenBotConfig;

function tenantConfigWithExecApprovals(approvers: string[]): OpenBotConfig {
  return {
    channels: {
      telegram: {
        accounts: {},
        execApprovals: { mode: "list", approvers },
      },
    },
  } as unknown as OpenBotConfig;
}

function execApprovalsOf(cfg: OpenBotConfig): unknown {
  return (cfg as { channels?: { telegram?: { execApprovals?: unknown } } }).channels?.telegram
    ?.execApprovals;
}

describe("channel execApprovals tenant isolation (2.8c, rides on 2.2 tenant-config)", () => {
  it("tenant A's execApprovals is visible to A but not to B or the platform default", () => {
    let store: TenantConfigStore = normalizeTenantConfigStore(null);
    // 企业 A 经 tenant-scoped config 写入自己的渠道 exec 审批策略。
    const aOverride = diffTenantOverride(
      platformDefault,
      tenantConfigWithExecApprovals(["alice@a.example"]),
    );
    store = setTenantConfigOverride(store, "tenant-a", aOverride);

    // A 解析视图：含自己的 execApprovals。
    const aCfg = resolveConfigForTenant({
      platformDefault,
      override: getTenantConfigOverride(store, "tenant-a"),
    });
    expect(execApprovalsOf(aCfg)).toEqual({ mode: "list", approvers: ["alice@a.example"] });

    // B 解析视图（无覆盖）：看不到 A 的 execApprovals（= 平台默认，无策略）。
    const bCfg = resolveConfigForTenant({
      platformDefault,
      override: getTenantConfigOverride(store, "tenant-b"),
    });
    expect(execApprovalsOf(bCfg)).toBeUndefined();

    // 平台默认本身不被 A 的写入污染（跨租户/全局隔离）。
    expect(execApprovalsOf(platformDefault)).toBeUndefined();
  });

  it("two tenants' execApprovals do not leak into each other", () => {
    let store: TenantConfigStore = normalizeTenantConfigStore(null);
    store = setTenantConfigOverride(
      store,
      "tenant-a",
      diffTenantOverride(platformDefault, tenantConfigWithExecApprovals(["a-admin"])),
    );
    store = setTenantConfigOverride(
      store,
      "tenant-b",
      diffTenantOverride(platformDefault, tenantConfigWithExecApprovals(["b-admin"])),
    );

    const aCfg = resolveConfigForTenant({
      platformDefault,
      override: getTenantConfigOverride(store, "tenant-a"),
    });
    const bCfg = resolveConfigForTenant({
      platformDefault,
      override: getTenantConfigOverride(store, "tenant-b"),
    });

    expect(execApprovalsOf(aCfg)).toEqual({ mode: "list", approvers: ["a-admin"] });
    expect(execApprovalsOf(bCfg)).toEqual({ mode: "list", approvers: ["b-admin"] });
    // 交集为空：A 的审批人绝不出现在 B 的解析视图，反之亦然。
    expect(JSON.stringify(execApprovalsOf(aCfg))).not.toContain("b-admin");
    expect(JSON.stringify(execApprovalsOf(bCfg))).not.toContain("a-admin");
  });
});
