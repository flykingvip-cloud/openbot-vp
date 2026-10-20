import { describe, expect, it } from "vitest";
import {
  assertActionAllowedForScopes,
  isActionAllowedForClient,
  listStewardActions,
  resolveStewardAction,
} from "./daibai-action-catalog.js";
import { StewardAuthorizationError } from "./daibai-dispatch.js";
import type { GatewayClient } from "./types.js";

function clientWithScopes(scopes: string[]): GatewayClient {
  return { connect: { scopes } } as unknown as GatewayClient;
}

describe("daibai action catalog", () => {
  it("registers the three support actions (Phase 3 migration)", () => {
    const ids = listStewardActions().map((a) => a.actionId);
    expect(ids).toContain("support.case.create");
    expect(ids).toContain("support.case.reply_user");
    expect(ids).toContain("support.case.apply_resolution");
  });

  it("resolves a known action and exposes its scope/delegate", () => {
    const action = resolveStewardAction("support.case.create");
    expect(action?.requiredScope).toBe("operator.write");
    expect(action?.delegateTarget).toEqual({ mode: "service", ref: "supportCase.create" });
  });

  it("registers schedule.entry.add as a confirm-required write", () => {
    const action = resolveStewardAction("schedule.entry.add");
    expect(action?.requiredScope).toBe("operator.write");
    expect(action?.requiresUserConfirmation).toBe(true);
    expect(action?.delegateTarget).toEqual({ mode: "service", ref: "scheduleEntry.add" });
  });

  it("returns undefined for unknown actions", () => {
    expect(resolveStewardAction("agents.delete")).toBeUndefined();
  });

  it("never registers an ADMIN-scoped action (invariant: no admin in catalog)", () => {
    for (const action of listStewardActions()) {
      expect(action.requiredScope).not.toBe("operator.admin");
    }
  });

  it("blocks a client lacking the required write scope", () => {
    const action = resolveStewardAction("support.case.create")!;
    expect(() => assertActionAllowedForScopes(action, clientWithScopes(["operator.read"]))).toThrow(
      StewardAuthorizationError,
    );
    expect(isActionAllowedForClient(action, clientWithScopes(["operator.read"]))).toBe(false);
  });

  it("allows a client with the write scope", () => {
    const action = resolveStewardAction("support.case.create")!;
    expect(() =>
      assertActionAllowedForScopes(action, clientWithScopes(["operator.write"])),
    ).not.toThrow();
  });

  it("allows ADMIN as a superset", () => {
    const action = resolveStewardAction("support.case.create")!;
    expect(isActionAllowedForClient(action, clientWithScopes(["operator.admin"]))).toBe(true);
  });

  it("allows local clients without connect params (mirrors gateway trust model)", () => {
    const action = resolveStewardAction("support.case.create")!;
    expect(isActionAllowedForClient(action, null)).toBe(true);
  });
});
