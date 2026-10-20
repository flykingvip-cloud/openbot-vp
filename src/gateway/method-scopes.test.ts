import { describe, expect, it } from "vitest";
import {
  authorizeOperatorScopesForMethod,
  isGatewayMethodClassified,
  PLATFORM_SCOPE,
  READ_SCOPE,
  resolveLeastPrivilegeOperatorScopesForMethod,
  resolveRequiredOperatorScopeForMethod,
} from "./method-scopes.js";
import { listGatewayMethods } from "./server-methods-list.js";
import { coreGatewayHandlers } from "./server-methods.js";

describe("method scope resolution", () => {
  it("classifies sessions.resolve + config.schema.lookup as read and poll as write", () => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod("sessions.resolve")).toEqual([
      "operator.read",
    ]);
    expect(resolveLeastPrivilegeOperatorScopesForMethod("config.schema.lookup")).toEqual([
      "operator.read",
    ]);
    expect(resolveLeastPrivilegeOperatorScopesForMethod("poll")).toEqual(["operator.write"]);
  });

  it("leaves node-only pending drain outside operator scopes", () => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod("node.pending.drain")).toEqual([]);
  });

  it("returns empty scopes for unknown methods", () => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod("totally.unknown.method")).toEqual([]);
  });
});

describe("operator scope authorization", () => {
  it("allows read methods with operator.read or operator.write", () => {
    expect(authorizeOperatorScopesForMethod("health", ["operator.read"])).toEqual({
      allowed: true,
    });
    expect(authorizeOperatorScopesForMethod("health", ["operator.write"])).toEqual({
      allowed: true,
    });
    expect(authorizeOperatorScopesForMethod("config.schema.lookup", ["operator.read"])).toEqual({
      allowed: true,
    });
  });

  it("requires operator.write for write methods", () => {
    expect(authorizeOperatorScopesForMethod("send", ["operator.read"])).toEqual({
      allowed: false,
      missingScope: "operator.write",
    });
  });

  it("requires approvals scope for approval methods", () => {
    expect(authorizeOperatorScopesForMethod("exec.approval.resolve", ["operator.write"])).toEqual({
      allowed: false,
      missingScope: "operator.approvals",
    });
  });

  it("requires operator.platform for platform-only methods", () => {
    expect(authorizeOperatorScopesForMethod("doctor.memory.health", ["operator.read"])).toEqual({
      allowed: false,
      missingScope: "operator.platform",
    });
    expect(authorizeOperatorScopesForMethod("doctor.memory.health", ["operator.platform"])).toEqual(
      {
        allowed: true,
      },
    );
    expect(authorizeOperatorScopesForMethod("doctor.memory.health", ["operator.admin"])).toEqual({
      allowed: true,
    });
  });

  it("requires admin for unknown methods", () => {
    expect(authorizeOperatorScopesForMethod("unknown.method", ["operator.read"])).toEqual({
      allowed: false,
      missingScope: "operator.admin",
    });
  });
});

describe("Phase 1 doctor.memory.health classification", () => {
  it("keeps platform health off READ_SCOPE and classifies the three RPCs", () => {
    expect(resolveRequiredOperatorScopeForMethod("doctor.memory.health")).toBe(PLATFORM_SCOPE);
    expect(resolveRequiredOperatorScopeForMethod("doctor.memory.health.tenant")).toBe(
      "operator.admin",
    );
    expect(resolveRequiredOperatorScopeForMethod("doctor.memory.health.summary")).toBe(
      "operator.admin",
    );
    expect(resolveRequiredOperatorScopeForMethod("doctor.memory.status")).toBe(READ_SCOPE);
    expect(isGatewayMethodClassified("doctor.memory.health")).toBe(true);
    expect(isGatewayMethodClassified("doctor.memory.health.tenant")).toBe(true);
    expect(isGatewayMethodClassified("doctor.memory.health.summary")).toBe(true);
    expect(authorizeOperatorScopesForMethod("doctor.memory.health", [READ_SCOPE]).allowed).toBe(
      false,
    );
  });
});

describe("core gateway method classification", () => {
  it("classifies every exposed core gateway handler method", () => {
    const unclassified = Object.keys(coreGatewayHandlers).filter(
      (method) => !isGatewayMethodClassified(method),
    );
    expect(unclassified).toEqual([]);
  });

  it("classifies every listed gateway method name", () => {
    const unclassified = listGatewayMethods().filter(
      (method) => !isGatewayMethodClassified(method),
    );
    expect(unclassified).toEqual([]);
  });
});
