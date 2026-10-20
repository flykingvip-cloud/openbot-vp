import { describe, expect, it } from "vitest";
import {
  evaluateToolsInvokeCapability,
  readToolsInvokeCapabilityCell,
} from "./tools-invoke-capability.js";

describe("evaluateToolsInvokeCapability", () => {
  const policy = {
    "tenant-1": {
      sessions_list: "allow" as const,
      sessions_send: "deny" as const,
      gateway: "yes",
    },
    " tenant-2 ": {
      agents_list: "deny" as const,
    },
  };

  it("returns unset when no policy table is configured", () => {
    expect(
      evaluateToolsInvokeCapability({ tenantId: "tenant-1", toolName: "sessions_list" }),
    ).toEqual({ effect: "unset", absence: "not-configured" });
    expect(
      evaluateToolsInvokeCapability({
        tenantId: "tenant-1",
        toolName: "sessions_list",
        policy: null,
      }),
    ).toEqual({ effect: "unset", absence: "not-configured" });
  });

  it("returns unset when the tenant or tool has no explicit allow or deny", () => {
    expect(
      evaluateToolsInvokeCapability({
        tenantId: "tenant-1",
        toolName: "agents_list",
        policy,
      }),
    ).toEqual({ effect: "unset", absence: "absent" });
    expect(
      evaluateToolsInvokeCapability({
        tenantId: "missing-tenant",
        toolName: "sessions_list",
        policy: {},
      }),
    ).toEqual({ effect: "unset", absence: "absent" });
  });

  it("returns the explicit allow or deny for that tenant and tool", () => {
    expect(
      evaluateToolsInvokeCapability({
        tenantId: "tenant-1",
        toolName: "sessions_list",
        policy,
      }),
    ).toEqual({ effect: "allow" });
    expect(
      evaluateToolsInvokeCapability({
        tenantId: "tenant-1",
        toolName: "sessions_send",
        policy,
      }),
    ).toEqual({ effect: "deny" });
    expect(readToolsInvokeCapabilityCell(policy, " tenant-2 ", "agents_list")).toBe("deny");
  });

  it("does not treat a non allow/deny cell as allow", () => {
    expect(
      evaluateToolsInvokeCapability({
        tenantId: "tenant-1",
        toolName: "gateway",
        policy,
      }),
    ).toEqual({ effect: "unset", absence: "absent" });
    expect(
      evaluateToolsInvokeCapability({
        tenantId: " ",
        toolName: "sessions_list",
        policy,
      }),
    ).toEqual({ effect: "unset", absence: "absent" });
  });

  it("maps a throwing lookup to unset", () => {
    expect(
      evaluateToolsInvokeCapability({
        tenantId: "tenant-1",
        toolName: "sessions_list",
        policy,
        lookup: () => {
          throw new Error("store down");
        },
      }),
    ).toEqual({ effect: "unset", absence: "lookup-failed" });
  });

  it("uses a lookup verdict and ignores a non verdict", () => {
    expect(
      evaluateToolsInvokeCapability({
        tenantId: "tenant-1",
        toolName: "sessions_send",
        lookup: () => "allow",
      }),
    ).toEqual({ effect: "allow" });
    expect(
      evaluateToolsInvokeCapability({
        tenantId: "tenant-1",
        toolName: "sessions_send",
        lookup: () => "skip",
      }),
    ).toEqual({ effect: "unset", absence: "absent" });
  });
});
