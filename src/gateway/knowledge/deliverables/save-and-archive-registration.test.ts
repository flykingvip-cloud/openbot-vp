// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  authorizeOperatorScopesForMethod,
  isGatewayMethodClassified,
  resolveLeastPrivilegeOperatorScopesForMethod,
} from "../../method-scopes.js";
import { listGatewayMethods } from "../../server-methods-list.js";

const METHOD = "knowledge.deliverables.saveAndArchive";
const LOOKUP = "knowledge.deliverables.archiveLookup";

describe("knowledge.deliverables.saveAndArchive gateway registration", () => {
  it("is listed as a gateway method", () => {
    expect(listGatewayMethods()).toContain(METHOD);
    expect(listGatewayMethods()).toContain(LOOKUP);
  });

  it("is classified (so it is not silently admin-only)", () => {
    expect(isGatewayMethodClassified(METHOD)).toBe(true);
  });

  it("requires operator.write, not operator.read", () => {
    expect(resolveLeastPrivilegeOperatorScopesForMethod(METHOD)).toEqual(["operator.write"]);
    expect(authorizeOperatorScopesForMethod(METHOD, ["operator.read"])).toEqual({
      allowed: false,
      missingScope: "operator.write",
    });
    expect(authorizeOperatorScopesForMethod(METHOD, ["operator.write"])).toEqual({
      allowed: true,
    });
  });

  it("archiveLookup is a classified read", () => {
    expect(isGatewayMethodClassified(LOOKUP)).toBe(true);
    expect(resolveLeastPrivilegeOperatorScopesForMethod(LOOKUP)).toEqual(["operator.read"]);
  });
});
