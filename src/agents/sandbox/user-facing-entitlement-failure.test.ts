import { describe, expect, it } from "vitest";
import { userFacingPreReplyFailure } from "./docker-engine-client.js";
import {
  ENTITLEMENT_USER_MESSAGES,
  messageForWorkerHeartbeatReason,
  userFacingEntitlementPreReplyFailure,
} from "./user-facing-entitlement-failure.js";

describe("userFacingEntitlementPreReplyFailure", () => {
  it("maps account-worker billing lease-expired to the enterprise renewal sentence", () => {
    expect(
      userFacingEntitlementPreReplyFailure("account worker stopped billing actions: lease-expired"),
    ).toBe(ENTITLEMENT_USER_MESSAGES.leaseExpired);
  });

  it("maps each heartbeat stop reason used in chat failures", () => {
    expect(messageForWorkerHeartbeatReason("quota")).toBe(ENTITLEMENT_USER_MESSAGES.quota);
    expect(messageForWorkerHeartbeatReason("revoked")).toBe(ENTITLEMENT_USER_MESSAGES.leaseRevoked);
    expect(messageForWorkerHeartbeatReason("not-allowed")).toBe(
      ENTITLEMENT_USER_MESSAGES.notAllowed,
    );
  });

  it("maps model and workspace authorization denials", () => {
    expect(
      userFacingEntitlementPreReplyFailure("400: Requested model openai/gpt-x not supported"),
    ).toBe(ENTITLEMENT_USER_MESSAGES.modelNotSupported);
    expect(userFacingEntitlementPreReplyFailure("workspace_authorization_failed")).toBe(
      ENTITLEMENT_USER_MESSAGES.workspaceAuthorization,
    );
  });

  it("leaves unrelated errors alone", () => {
    expect(userFacingEntitlementPreReplyFailure("sandbox is not defined")).toBeNull();
  });

  it("is reached from userFacingPreReplyFailure so chat never dumps the English lease line", () => {
    expect(userFacingPreReplyFailure("account worker stopped billing actions: lease-expired")).toBe(
      ENTITLEMENT_USER_MESSAGES.leaseExpired,
    );
  });
});
