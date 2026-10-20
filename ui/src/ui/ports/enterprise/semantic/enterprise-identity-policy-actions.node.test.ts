import { describe, expect, it } from "vitest";
import {
  filterPolicyActionsToVerified,
  listVerifiedOperationalActionsForIdentity,
} from "./enterprise-identity-policy-actions.ts";

const catalog = {
  identities: [
    { identityId: "id-feishu", provider: "feishu" },
    { identityId: "id-email", provider: "email" },
  ],
  providerCatalog: [
    {
      provider: "feishu",
      operationalActions: [
        { action: "send_message", label: "发送消息" },
        { action: "create_doc", label: "创建文档" },
      ],
    },
    {
      provider: "email",
      operationalActions: [{ action: "send_email", label: "发送邮件" }],
    },
  ],
};

describe("enterprise identity policy actions", () => {
  it("lists verified operational actions for a known identity", () => {
    expect(listVerifiedOperationalActionsForIdentity(catalog, "id-feishu")).toEqual([
      { action: "send_message", label: "发送消息" },
      { action: "create_doc", label: "创建文档" },
    ]);
  });

  it("filters unknown or sync-only actions against provider catalog", () => {
    expect(
      filterPolicyActionsToVerified({
        catalog,
        identityId: "id-feishu",
        actions: ["send_message", "sync_inbox", "create_doc", ""],
      }),
    ).toEqual(["send_message", "create_doc"]);
  });

  it("keeps non-empty actions when catalog has no verified entries", () => {
    expect(
      filterPolicyActionsToVerified({
        catalog,
        identityId: "missing",
        actions: ["send_message", "sync_inbox"],
      }),
    ).toEqual(["send_message", "sync_inbox"]);
  });
});
