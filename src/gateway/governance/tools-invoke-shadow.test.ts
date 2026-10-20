import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { appendGovernanceShadowDecisionMock } = vi.hoisted(() => ({
  appendGovernanceShadowDecisionMock: vi.fn(),
}));

vi.mock("./shadow-sink.js", () => ({
  appendGovernanceShadowDecision: appendGovernanceShadowDecisionMock,
}));

import {
  applyToolsInvokeGovernance,
  isToolsInvokeShadowEnabled,
  recordToolsInvokeShadow,
  resolveToolsInvokeGovernanceMode,
  TOOLS_INVOKE_MODE_DEFAULT,
  TOOLS_INVOKE_MODE_ENV,
  TOOLS_INVOKE_SHADOW_ENV,
} from "./tools-invoke-shadow.js";

describe("/tools/invoke capability shadow", () => {
  beforeEach(() => {
    appendGovernanceShadowDecisionMock.mockReset();
    appendGovernanceShadowDecisionMock.mockResolvedValue(true);
  });

  it("does not read the preflight observe flag", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "tools-invoke-shadow.ts"),
      "utf8",
    );
    expect(source).not.toContain("OPENBOT_HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE");
    expect(source).not.toContain("auditManagementDecision");
    expect(isToolsInvokeShadowEnabled({})).toBe(false);
    expect(isToolsInvokeShadowEnabled({ OPENBOT_HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE: "1" })).toBe(
      false,
    );
    expect(isToolsInvokeShadowEnabled({ [TOOLS_INVOKE_SHADOW_ENV]: "1" })).toBe(true);
  });

  it("writes nothing when the flag is off", async () => {
    await recordToolsInvokeShadow({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      env: {},
    });
    expect(appendGovernanceShadowDecisionMock).not.toHaveBeenCalled();
  });

  it("records a legacy skip when the caller has no enterprise scope", async () => {
    await recordToolsInvokeShadow({
      toolName: "sessions_list",
      platformUserId: "user-1",
      env: { [TOOLS_INVOKE_SHADOW_ENV]: "1" },
    });
    expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
      effect: "skipped",
      mode: "legacy",
      source: "capability",
      reason: "no-enterprise-scope",
      actorId: "platform-user:user-1",
      subject: { kind: "capability", id: "sessions_list" },
      shadow: { divergence: "D5" },
    });
  });

  it("records skipped, not allow, when an enterprise caller has no capability policy", async () => {
    await recordToolsInvokeShadow({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      membershipId: "mem-1",
      env: { [TOOLS_INVOKE_SHADOW_ENV]: "1", user: "person@example.com" },
    });
    const envelope = appendGovernanceShadowDecisionMock.mock.calls[0]?.[0];
    expect(envelope).toMatchObject({
      effect: "skipped",
      mode: "shadow",
      source: "capability",
      reason: "tenant-capability-not-enforced",
      tenantId: "tenant-1",
      actorId: "membership:mem-1",
      subject: { kind: "capability", id: "sessions_list" },
      shadow: { existing: { effect: "allow" }, divergence: "D5" },
    });
    expect(JSON.stringify(envelope)).not.toContain("person@example.com");
  });

  it("records allow when the tenant capability policy allows the tool", async () => {
    await recordToolsInvokeShadow({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      env: { [TOOLS_INVOKE_SHADOW_ENV]: "1" },
      capabilityPolicy: { "tenant-1": { sessions_list: "allow" } },
    });
    expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
      effect: "allow",
      mode: "shadow",
      source: "capability",
      reason: "tenant-capability-allow",
      tenantId: "tenant-1",
      subject: { kind: "capability", id: "sessions_list" },
      shadow: { existing: { effect: "allow" }, divergence: "D0" },
    });
  });

  it("records deny, compared with the existing HTTP allow, when policy denies the tool", async () => {
    await recordToolsInvokeShadow({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      env: { [TOOLS_INVOKE_SHADOW_ENV]: "1" },
      capabilityPolicy: { "tenant-1": { sessions_list: "deny" } },
    });
    const envelope = appendGovernanceShadowDecisionMock.mock.calls[0]?.[0];
    expect(envelope).toMatchObject({
      effect: "deny",
      mode: "shadow",
      source: "capability",
      reason: "tenant-capability-deny",
      tenantId: "tenant-1",
      shadow: { existing: { effect: "allow", reason: "not-enforced" }, divergence: "D1" },
    });
    expect(envelope.effect).not.toBe("allow");
  });

  it("stays skipped when the configured table has no row for the tool", async () => {
    await recordToolsInvokeShadow({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      env: { [TOOLS_INVOKE_SHADOW_ENV]: "1" },
      capabilityPolicy: { "tenant-1": { sessions_send: "allow" } },
    });
    expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
      effect: "skipped",
      mode: "shadow",
      reason: "capability-policy-absent",
      shadow: { existing: { effect: "allow" }, divergence: "D5" },
    });
  });

  it("stays skipped when the capability lookup throws", async () => {
    await recordToolsInvokeShadow({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      env: { [TOOLS_INVOKE_SHADOW_ENV]: "1" },
      capabilityPolicy: { "tenant-1": { sessions_list: "allow" } },
      capabilityLookup: () => {
        throw new Error("store down");
      },
    });
    const envelope = appendGovernanceShadowDecisionMock.mock.calls[0]?.[0];
    expect(envelope).toMatchObject({
      effect: "skipped",
      mode: "shadow",
      reason: "tenant-capability-not-enforced",
      shadow: { divergence: "D5" },
    });
    expect(envelope.effect).not.toBe("allow");
  });

  it("does not record a deny policy when the shadow flag is off", async () => {
    await recordToolsInvokeShadow({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      env: {},
      capabilityPolicy: { "tenant-1": { sessions_list: "deny" } },
    });
    expect(appendGovernanceShadowDecisionMock).not.toHaveBeenCalled();
  });
});

describe("/tools/invoke TOOLS_INVOKE_MODE", () => {
  beforeEach(() => {
    appendGovernanceShadowDecisionMock.mockReset();
    appendGovernanceShadowDecisionMock.mockResolvedValue(true);
  });

  it("defaults MODE to shadow (never enforced) when unset", () => {
    expect(resolveToolsInvokeGovernanceMode({})).toBe("shadow");
    expect(resolveToolsInvokeGovernanceMode({ [TOOLS_INVOKE_MODE_ENV]: "" })).toBe("shadow");
    expect(resolveToolsInvokeGovernanceMode({ [TOOLS_INVOKE_MODE_ENV]: "bogus" })).toBe("shadow");
    expect(TOOLS_INVOKE_MODE_DEFAULT).toBe("shadow");
    expect(TOOLS_INVOKE_MODE_DEFAULT).not.toBe("enforced");
  });

  it("parses legacy|shadow|enforced from env", () => {
    expect(resolveToolsInvokeGovernanceMode({ [TOOLS_INVOKE_MODE_ENV]: "legacy" })).toBe("legacy");
    expect(resolveToolsInvokeGovernanceMode({ [TOOLS_INVOKE_MODE_ENV]: "SHADOW" })).toBe("shadow");
    expect(resolveToolsInvokeGovernanceMode({ [TOOLS_INVOKE_MODE_ENV]: "enforced" })).toBe(
      "enforced",
    );
  });

  it("legacy skips capability evaluate and never rejects HTTP", async () => {
    const result = await applyToolsInvokeGovernance({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      env: {
        [TOOLS_INVOKE_SHADOW_ENV]: "1",
        [TOOLS_INVOKE_MODE_ENV]: "legacy",
      },
      capabilityPolicy: { "tenant-1": { sessions_list: "deny" } },
      capabilityLookup: () => {
        throw new Error("must not evaluate in legacy");
      },
    });
    expect(result.reject).toBeUndefined();
    expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
      effect: "skipped",
      mode: "legacy",
      reason: "legacy",
    });
  });

  it("shadow (default) does not reject HTTP on capability deny", async () => {
    const result = await applyToolsInvokeGovernance({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      env: { [TOOLS_INVOKE_SHADOW_ENV]: "1" },
      capabilityPolicy: { "tenant-1": { sessions_list: "deny" } },
    });
    expect(result.reject).toBeUndefined();
    expect(result.decision).toMatchObject({
      effect: "deny",
      mode: "shadow",
      reason: "tenant-capability-deny",
    });
  });

  it("enforced + deny returns HTTP reject aligned with deny-list 404 not_found", async () => {
    const result = await applyToolsInvokeGovernance({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      env: { [TOOLS_INVOKE_MODE_ENV]: "enforced" },
      capabilityPolicy: { "tenant-1": { sessions_list: "deny" } },
    });
    expect(result.reject).toEqual({
      status: 404,
      body: {
        ok: false,
        error: { type: "not_found", message: "Tool not available: sessions_list" },
      },
    });
    expect(result.decision).toMatchObject({
      effect: "deny",
      mode: "enforced",
      reason: "tenant-capability-deny",
    });
  });

  it("enforced + allow does not reject", async () => {
    const result = await applyToolsInvokeGovernance({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      env: { [TOOLS_INVOKE_MODE_ENV]: "enforced" },
      capabilityPolicy: { "tenant-1": { sessions_list: "allow" } },
    });
    expect(result.reject).toBeUndefined();
    expect(result.decision).toMatchObject({ effect: "allow", mode: "enforced" });
  });

  it("enforced + skipped/unevaluated does not reject (never allow)", async () => {
    const noPolicy = await applyToolsInvokeGovernance({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      env: { [TOOLS_INVOKE_MODE_ENV]: "enforced" },
    });
    expect(noPolicy.reject).toBeUndefined();
    expect(noPolicy.decision).toMatchObject({
      effect: "skipped",
      mode: "enforced",
    });
    expect(noPolicy.decision?.effect).not.toBe("allow");

    const noEnterprise = await applyToolsInvokeGovernance({
      toolName: "sessions_list",
      env: { [TOOLS_INVOKE_MODE_ENV]: "enforced" },
    });
    expect(noEnterprise.reject).toBeUndefined();
    expect(noEnterprise.decision).toMatchObject({
      effect: "skipped",
      mode: "legacy",
      reason: "no-enterprise-scope",
    });
  });

  it("TOOLS_INVOKE_SHADOW stays default off", () => {
    expect(isToolsInvokeShadowEnabled({})).toBe(false);
    expect(isToolsInvokeShadowEnabled({ [TOOLS_INVOKE_SHADOW_ENV]: "0" })).toBe(false);
  });
});

describe("/tools/invoke envelope entry stamp (P3)", () => {
  beforeEach(() => {
    appendGovernanceShadowDecisionMock.mockReset();
    appendGovernanceShadowDecisionMock.mockResolvedValue(true);
  });

  it.each([
    ["no enterprise scope", {}, undefined],
    ["enterprise scope, no policy table", { enterpriseId: "tenant-1" }, undefined],
    [
      "enterprise scope, policy allow",
      { enterpriseId: "tenant-1" },
      { "tenant-1": { sessions_list: "allow" as const } },
    ],
    [
      "enterprise scope, policy deny",
      { enterpriseId: "tenant-1" },
      { "tenant-1": { sessions_list: "deny" as const } },
    ],
    [
      "enterprise scope, table without this tool",
      { enterpriseId: "tenant-1" },
      { "tenant-1": { other_tool: "allow" as const } },
    ],
  ])("stamps entry E8 (%s)", async (_label, scope, capabilityPolicy) => {
    await applyToolsInvokeGovernance({
      toolName: "sessions_list",
      ...scope,
      env: { [TOOLS_INVOKE_SHADOW_ENV]: "1" },
      ...(capabilityPolicy ? { capabilityPolicy } : {}),
    });
    expect(appendGovernanceShadowDecisionMock).toHaveBeenCalledTimes(1);
    expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
      source: "capability",
      entry: "E8",
    });
  });

  it("stamps entry E8 under legacy and enforced too", async () => {
    const legacy = await applyToolsInvokeGovernance({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      env: { [TOOLS_INVOKE_SHADOW_ENV]: "1", [TOOLS_INVOKE_MODE_ENV]: "legacy" },
    });
    const enforced = await applyToolsInvokeGovernance({
      toolName: "sessions_list",
      enterpriseId: "tenant-1",
      env: { [TOOLS_INVOKE_MODE_ENV]: "enforced" },
      capabilityPolicy: { "tenant-1": { sessions_list: "deny" } },
    });
    expect(legacy.decision).toMatchObject({ mode: "legacy", entry: "E8" });
    expect(enforced.decision).toMatchObject({ mode: "enforced", effect: "deny", entry: "E8" });
    expect(enforced.reject?.status).toBe(404);
  });
});
