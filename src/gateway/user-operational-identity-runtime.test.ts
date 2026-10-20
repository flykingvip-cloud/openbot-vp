// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeUserOperationalIdentityStore } from "./user-operational-identity-persistence.js";
import {
  persistPersonalEmailBindingHandoff,
  formatUserOperationalIdentityRuntimePrompt,
} from "./user-operational-identity-runtime.js";

describe("user operational identity runtime personal-email handoff", () => {
  it("creates binding request + continuation for personal-email Path B", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const handoff = persistPersonalEmailBindingHandoff({
      store,
      ownerId: "user-1",
      agentId: "main",
      agentScope: "owned",
      provider: "personal-email",
      requestedAction: "send_email",
      sessionKey: "agent:main:main",
      nowIso: "2026-08-11T00:00:00.000Z",
    });
    expect(handoff.bindingRequestId).toBeTruthy();
    expect(handoff.continuationToken).toBeTruthy();
    expect(Object.keys(store.continuations)).toHaveLength(1);
    expect(Object.keys(store.bindingRequests)).toHaveLength(1);
  });
});

describe("user operational identity personal-email grant prompt", () => {
  it("tells a granted agent to send with the tool", () => {
    const prompt = formatUserOperationalIdentityRuntimePrompt([
      {
        identityId: "id-mail",
        displayName: "个人邮箱",
        provider: "personal-email",
        providerLabel: "个人邮箱",
        status: "active",
        allowedActions: ["send_email", "reply_email"],
        grantIds: ["g1"],
        hasGrant: true,
      },
    ]);
    expect(prompt).toContain("ACTIVE");
    expect(prompt).toContain("send_email");
    expect(prompt).toContain("Do not say authorization is missing");
    expect(prompt).toContain("sendmail");
  });

  it("says the grant is absent when another provider is the only grant", () => {
    const prompt = formatUserOperationalIdentityRuntimePrompt([
      {
        identityId: "id-oa",
        displayName: "个人公众号",
        provider: "wechat-official",
        providerLabel: "微信公众号",
        status: "active",
        allowedActions: ["publish_draft"],
        grantIds: ["g1"],
        hasGrant: true,
      },
    ]);
    expect(prompt).toContain("no active personal-email");
    expect(prompt).not.toContain("grant for THIS agent is ACTIVE");
  });
});

describe("user operational identity wechat draft prompt", () => {
  it("tells agents not to run leftover wechat-article publish scripts", () => {
    const prompt = formatUserOperationalIdentityRuntimePrompt([
      {
        identityId: "id-oa",
        displayName: "个人公众号",
        provider: "wechat-official",
        providerLabel: "微信公众号",
        status: "active",
        allowedActions: ["publish_draft", "upload_thumb"],
        grantIds: ["g1"],
        hasGrant: true,
      },
    ]);
    expect(prompt).toContain("publish_draft");
    expect(prompt).toContain("leftover publish scripts");
  });
});
