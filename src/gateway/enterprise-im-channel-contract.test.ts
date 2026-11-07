import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendFeishuEnterpriseConfigAudit,
  applyFeishuEnterpriseObservation,
  classifyFeishuAppCapabilities,
  presentFeishuEnterpriseObservation,
  feishuEmployeeUiHint,
  isEnterpriseImChildExecutionBlocked,
  readFeishuEnterpriseChannelContract,
} from "./enterprise-im-channel-contract.js";
import { persistFeishuEnterpriseProbe } from "./enterprise-im-channel-persist.js";
import {
  getTenantConfigOverride,
  loadTenantConfigStore,
  resolveConfigForTenant,
} from "./tenant-config.js";

describe("enterprise IM channel contract (slice 1a)", () => {
  it("classifies app scopes without treating them as employee authorization", () => {
    const status = classifyFeishuAppCapabilities({
      checkedAt: "2026-11-07T00:00:00.000Z",
      grantedScopeNames: [
        "im:message",
        "im:message.send_as_user",
        "docx:document:readonly",
        "im:message.group_at_msg:readonly",
      ],
    });
    expect(status.projectGroupRead).toBe("granted");
    expect(status.projectDocs).toBe("granted");
    expect(status.sendAsUser).toBe("granted");
    expect(status.newMessageTrigger).toBe("granted");
    expect(feishuEmployeeUiHint({ channel: { enabled: true }, capability: status })).toBe(
      "app_can_attempt",
    );
  });

  it("marks unknown scopes as waiting for an admin, not ready", () => {
    const status = classifyFeishuAppCapabilities({
      checkedAt: "2026-11-07T00:00:00.000Z",
      grantedScopeNames: null,
    });
    expect(status.sendAsUser).toBe("unknown");
    expect(feishuEmployeeUiHint({ channel: { enabled: true }, capability: status })).toBe(
      "waiting_admin_scopes",
    );
  });

  it("records tenant_key from a connection check and does not use the account slug", () => {
    const config: Record<string, unknown> = {
      channels: {
        feishu: {
          enabled: true,
          accounts: { t_001_default: { appId: "cli_test" } },
        },
      },
    };
    const recorded = applyFeishuEnterpriseObservation({
      config,
      accountId: "t_001_default",
      nowIso: "2026-11-07T00:00:00.000Z",
      observation: {
        ok: true,
        tenantKey: "tenant-key-1",
        grantedScopeNames: ["im:message"],
      },
    });
    expect(recorded.platformEnterpriseId).toBe("tenant-key-1");
    expect(recorded.platformEnterpriseId).not.toBe("t_001_default");
    expect(recorded.capabilityStatus.projectGroupRead).toBe("granted");
    expect(recorded.capabilityStatus.sendAsUser).toBe("missing");
    const account = (
      config.channels as {
        feishu: { accounts: Record<string, { platformEnterpriseId?: string }> };
      }
    ).feishu.accounts.t_001_default;
    expect(account.platformEnterpriseId).toBe("tenant-key-1");
    expect(JSON.stringify(config)).not.toContain("appSecret");
    const contract = readFeishuEnterpriseChannelContract({
      config,
      accountId: "t_001_default",
    });
    expect(contract.employeeUiHint).toBe("waiting_admin_scopes");
    expect(contract.childExecutionBlocked).toBe(false);
  });

  it("does not clear a stored tenant_key when a later check omits it", () => {
    const config: Record<string, unknown> = {
      channels: {
        feishu: {
          enabled: true,
          accounts: { main: { platformEnterpriseId: "kept" } },
        },
      },
    };
    const recorded = applyFeishuEnterpriseObservation({
      config,
      accountId: "main",
      nowIso: "2026-11-07T00:00:00.000Z",
      observation: { ok: true, tenantKey: null, grantedScopeNames: null },
    });
    expect(recorded.platformEnterpriseId).toBe("kept");
  });

  it("blocks child execution when the enterprise connection is disabled or missing", () => {
    expect(isEnterpriseImChildExecutionBlocked(undefined)).toBe(true);
    expect(isEnterpriseImChildExecutionBlocked({ enabled: false })).toBe(true);
    expect(isEnterpriseImChildExecutionBlocked({ enabled: true })).toBe(false);
    const config: Record<string, unknown> = {
      channels: { feishu: { enabled: false, accounts: { main: {} } } },
    };
    expect(
      readFeishuEnterpriseChannelContract({ config, accountId: "main" }).childExecutionBlocked,
    ).toBe(true);
    expect(readFeishuEnterpriseChannelContract({ config, accountId: "main" }).employeeUiHint).toBe(
      "enterprise_not_open",
    );
  });

  it("audits enable and disable without writing secrets", () => {
    const previous: Record<string, unknown> = {
      channels: { feishu: { enabled: true, accounts: { main: { appSecret: "nope" } } } },
    };
    const next: Record<string, unknown> = {
      channels: { feishu: { enabled: false, accounts: { main: { appSecret: "nope" } } } },
    };
    appendFeishuEnterpriseConfigAudit({
      previous,
      next,
      nowIso: "2026-11-07T00:00:00.000Z",
    });
    const audit = (next.channels as { feishu: { connectionAudit: Array<{ kind: string }> } }).feishu
      .connectionAudit;
    expect(audit.map((event) => event.kind)).toEqual(["disable"]);
    expect(JSON.stringify(audit)).not.toContain("nope");
  });

  it("still presents tenant_key and capability when the save is not available", () => {
    const presented = presentFeishuEnterpriseObservation({
      observation: {
        ok: true,
        tenantKey: "tenant-key-live",
        grantedScopeNames: ["im:message"],
      },
      channelEnabled: true,
      nowIso: "2026-11-07T00:00:00.000Z",
      storedPlatformEnterpriseId: "kept",
    });
    expect(presented.platformEnterpriseId).toBe("tenant-key-live");
    expect(presented.capabilityStatus.projectGroupRead).toBe("granted");
    expect(presented.employeeUiHint).toBe("waiting_admin_scopes");
    const kept = presentFeishuEnterpriseObservation({
      observation: { ok: true, tenantKey: null, grantedScopeNames: null },
      channelEnabled: false,
      nowIso: "2026-11-07T00:00:00.000Z",
      storedPlatformEnterpriseId: "kept",
    });
    expect(kept.platformEnterpriseId).toBe("kept");
    expect(kept.childExecutionBlocked).toBe(true);
    expect(kept.employeeUiHint).toBe("enterprise_not_open");
  });

  it("persists the observed tenant_key on the tenant config account", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "feishu-enterprise-"));
    const storePath = path.join(dir, "tenant-config.json");
    const platformDefault = { channels: {} } as never;
    const recorded = await persistFeishuEnterpriseProbe({
      tenantId: "001",
      accountId: "t_001_default",
      storePath,
      platformDefault,
      now: new Date("2026-11-07T00:00:00.000Z"),
      observation: {
        ok: true,
        tenantKey: "tenant-key-9",
        grantedScopeNames: ["im:message", "im:message.send_as_user", "docx:document"],
      },
    });
    expect(recorded?.platformEnterpriseId).toBe("tenant-key-9");
    const store = await loadTenantConfigStore(storePath);
    const view = resolveConfigForTenant({
      platformDefault,
      override: getTenantConfigOverride(store, "001"),
    }) as {
      channels?: {
        feishu?: {
          accounts?: Record<string, { platformEnterpriseId?: string }>;
          connectionAudit?: Array<{ kind: string }>;
        };
      };
    };
    expect(view.channels?.feishu?.accounts?.t_001_default?.platformEnterpriseId).toBe(
      "tenant-key-9",
    );
    expect(
      view.channels?.feishu?.connectionAudit?.some((event) => event.kind === "connection_check"),
    ).toBe(true);
  });
});
