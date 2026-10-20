import { describe, expect, it } from "vitest";
import { authorizeOperatorScopesForMethod } from "../method-scopes.js";

describe("pattern-detection human-gate scopes", () => {
  it("requires operator.approvals for approve/reject/publish", () => {
    for (const method of [
      "pattern-detection.approve",
      "pattern-detection.reject",
      "pattern-detection.publish-draft-skill",
    ] as const) {
      expect(authorizeOperatorScopesForMethod(method, ["operator.write"])).toEqual({
        allowed: false,
        missingScope: "operator.approvals",
      });
      expect(authorizeOperatorScopesForMethod(method, ["operator.approvals"])).toEqual({
        allowed: true,
      });
    }
  });

  it("keeps ingest-sample as operator.write", () => {
    expect(
      authorizeOperatorScopesForMethod("pattern-detection.ingest-sample", ["operator.write"]),
    ).toEqual({ allowed: true });
  });
});
