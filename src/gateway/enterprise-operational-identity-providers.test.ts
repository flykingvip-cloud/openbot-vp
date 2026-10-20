import { describe, expect, it } from "vitest";
import { validateIdentityUsagePolicyInput } from "./enterprise-operational-identity-policy.js";
import {
  isOperationalIdentityPolicyAction,
  listOperationalIdentityProviderAllowedActions,
  listOperationalIdentityProviderCatalog,
  listOperationalIdentityProviderDataSyncActions,
  resolveOperationalIdentityProviderFromConnectorId,
  resolveOperationalIdentityProviderPresentation,
  resolveOperationalIdentityStatusHint,
  resolveUnsupportedOperationalIdentityConnectorMessage,
} from "./enterprise-operational-identity-providers.js";
import { registerEnterpriseIdentity } from "./enterprise-operational-identity-store.js";
import { normalizeEnterpriseSeatAssetsStore } from "./enterprise-seat-assets-backend.js";
import { registerConnectorCredentialBinding } from "./enterprise-seat-assets-store.js";

describe("operational identity provider adapters (M3)", () => {
  it("excludes feishu/wecom/dingtalk from catalog (MCP path instead)", () => {
    const catalog = listOperationalIdentityProviderCatalog();
    const providers = catalog.map((entry) => entry.provider);
    expect(providers).not.toContain("feishu");
    expect(providers).not.toContain("wecom");
    expect(providers).not.toContain("dingtalk");
    expect(resolveUnsupportedOperationalIdentityConnectorMessage("feishu")).toContain("MCP");
    expect(resolveUnsupportedOperationalIdentityConnectorMessage("wecom")).toContain("MCP");
    expect(resolveUnsupportedOperationalIdentityConnectorMessage("dingtalk")).toContain("MCP");
  });

  it("registers wechat-official as AppID/AppSecret only without OAuth scan", () => {
    const catalog = listOperationalIdentityProviderCatalog();
    const wechat = catalog.find((entry) => entry.provider === "wechat-official");
    expect(wechat?.registrationProfile.methods).toEqual(["manual"]);
    expect(wechat?.registrationProfile.oauthHint).toBeUndefined();
    expect(wechat?.oauthConfigured).toBeUndefined();
    expect(wechat?.oauthTicketReady).toBeUndefined();
    expect(wechat?.registrationProfile.verifyChecks.map((check) => check.key)).toEqual([
      "client_credential",
    ]);
    expect(
      wechat?.registrationProfile.verifyChecks.some((check) => check.key.includes("authorizer")),
    ).toBe(false);
  });

  it("aligns catalog with employee identities except personal mailbox and wechat", () => {
    const catalog = listOperationalIdentityProviderCatalog();
    const providers = catalog.map((entry) => entry.provider);
    expect(providers).not.toContain("enterprise-email");
    expect(providers).not.toContain("personal-email");
    expect(providers).not.toContain("wechat-personal");
    expect(providers).toContain("wechat-official");
    expect(providers).toContain("wechat-channels");
    expect(providers).toContain("github-org");
    expect(providers).not.toContain("jira");
    expect(providers).toContain("notion");
    expect(providers).toContain("weibo");
    expect(providers).toContain("douyin");
    expect(providers).toContain("bilibili");
    expect(providers).toContain("x-twitter");
    expect(providers).toContain("xiaohongshu");
    expect(providers).toContain("zhihu");
    expect(providers).toContain("kuaishou");
    expect(resolveUnsupportedOperationalIdentityConnectorMessage("enterprise-email")).toContain(
      "员工端",
    );
    expect(resolveOperationalIdentityProviderPresentation("enterprise-email")).toEqual({
      label: "企业邮箱（员工自行配置，已移出企业目录）",
      category: "official",
      catalogRemoved: true,
    });
    expect(resolveUnsupportedOperationalIdentityConnectorMessage("jira")).toContain("Jira");
    expect(resolveOperationalIdentityProviderPresentation("jira")).toEqual({
      label: "Jira（已移出企业目录）",
      category: "business",
      catalogRemoved: true,
    });
  });

  it("maps github-org and notion connectors to explicit operational whitelists", () => {
    expect(resolveOperationalIdentityProviderFromConnectorId("github-org")).toBe("github-org");
    expect(listOperationalIdentityProviderAllowedActions("github-org")).toEqual([
      "create_issue",
      "create_comment",
    ]);
    expect(resolveOperationalIdentityProviderFromConnectorId("jira")).toBeNull();
    expect(listOperationalIdentityProviderAllowedActions("notion")).toEqual([
      "create_page",
      "update_page",
      "publish_page",
    ]);
  });

  it("separates wechat official publish actions from data sync actions", () => {
    expect(listOperationalIdentityProviderAllowedActions("wechat-official")).toEqual([
      "upload_thumb",
      "upload_content_image",
      "publish_draft",
      "publish_article",
      "get_publish_status",
      "broadcast_article",
    ]);
    expect(listOperationalIdentityProviderDataSyncActions("wechat-official")).toEqual([
      "sync_follower_stats",
      "sync_article_metrics",
    ]);
    expect(isOperationalIdentityPolicyAction("wechat-official", "publish_article")).toBe(true);
    expect(isOperationalIdentityPolicyAction("wechat-official", "sync_follower_stats")).toBe(false);
  });

  it("rejects data_sync actions in identity usage policy validation", () => {
    const store = normalizeEnterpriseSeatAssetsStore(null, 4);
    const nowIso = "2026-06-06T00:00:00.000Z";
    store.seats["seat-1"] = {
      seatId: "seat-1",
      tenantId: "acme",
      title: "Ops",
      status: "occupied",
      defaultSpaceIds: [],
      defaultAgentAssetIds: ["agent-1"],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const credential = registerConnectorCredentialBinding({
      store,
      tenantId: "acme",
      connectorId: "wechat-official",
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso,
    });
    const identity = registerEnterpriseIdentity({
      store,
      tenantId: "acme",
      displayName: "Acme Official Account",
      credentialBindingId: credential.credentialBindingId,
      nowIso,
    });
    expect(identity.ok).toBe(true);
    if (!identity.ok) {
      return;
    }
    const validation = validateIdentityUsagePolicyInput({
      store,
      tenantId: "acme",
      identityId: identity.identity.identityId,
      provider: "wechat-official",
      seatIds: ["seat-1"],
      allowedAgentIds: [],
      allowedActions: ["sync_follower_stats"],
    });
    expect(validation.ok).toBe(false);
    if (validation.ok) {
      return;
    }
    expect(validation.code).toBe("ENTERPRISE_IDENTITY_ACTION_SYNC_ONLY");
  });

  it("degrades personal wechat connector with explicit message", () => {
    expect(resolveOperationalIdentityProviderFromConnectorId("wechat")).toBeNull();
    expect(resolveUnsupportedOperationalIdentityConnectorMessage("wechat")).toContain("个人微信");
  });

  it("returns provider-specific reauth hints", () => {
    const hint = resolveOperationalIdentityStatusHint({
      provider: "notion",
      status: "reauth_required",
    });
    expect(hint.tone).toBe("warn");
    expect(hint.detail).toContain("Notion");
  });
});
