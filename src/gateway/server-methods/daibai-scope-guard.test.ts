import { describe, expect, it } from "vitest";
import { authorizeOperatorScopesForMethod, isGatewayMethodClassified } from "../method-scopes.js";
import { listStewardActions } from "./daibai-action-catalog.js";

describe("daibai scope registration guard", () => {
  it("classifies user.daibai ask/execute in operator scopes", () => {
    expect(isGatewayMethodClassified("user.daibai.ask")).toBe(true);
    expect(isGatewayMethodClassified("user.daibai.execute")).toBe(true);
    expect(authorizeOperatorScopesForMethod("user.daibai.ask", ["operator.read"]).allowed).toBe(
      true,
    );
    expect(authorizeOperatorScopesForMethod("user.daibai.execute", ["operator.read"]).allowed).toBe(
      false,
    );
    expect(
      authorizeOperatorScopesForMethod("user.daibai.execute", ["operator.write"]).allowed,
    ).toBe(true);
  });

  it("keeps steward catalog free of admin-scoped actions", () => {
    const adminActions = listStewardActions().filter(
      (action) => action.requiredScope === ("operator.admin" as never),
    );
    expect(adminActions).toEqual([]);
  });
});
