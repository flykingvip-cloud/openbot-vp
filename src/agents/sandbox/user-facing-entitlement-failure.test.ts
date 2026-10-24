import { describe, expect, it } from "vitest";
import { userFacingPreReplyFailure } from "./docker-engine-client.js";
import {
  ENTITLEMENT_USER_MESSAGES,
  isSoftRecoverableEntitlementFailure,
  isSoftRecoverableEntitlementReason,
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

  it("does not surface lease-mismatch or stale-snapshot as 「请重新发送」", () => {
    expect(isSoftRecoverableEntitlementReason("lease-mismatch")).toBe(true);
    expect(isSoftRecoverableEntitlementReason("stale-snapshot")).toBe(true);
    expect(messageForWorkerHeartbeatReason("lease-mismatch")).toBeNull();
    expect(messageForWorkerHeartbeatReason("stale-snapshot")).toBeNull();
    expect(
      userFacingEntitlementPreReplyFailure(
        "account worker stopped billing actions: lease-mismatch",
      ),
    ).toBeNull();
    expect(
      userFacingEntitlementPreReplyFailure(
        "account worker stopped billing actions: stale-snapshot",
      ),
    ).toBeNull();
    expect(
      userFacingEntitlementPreReplyFailure("AccountWorkerFailedError: stale snapshot"),
    ).toBeNull();
    expect(isSoftRecoverableEntitlementFailure("stale snapshot")).toBe(true);
    expect(isSoftRecoverableEntitlementFailure("lease-mismatch mid-tool")).toBe(true);
    const softCopy =
      userFacingPreReplyFailure("account worker stopped billing actions: stale-snapshot") ?? "";
    expect(softCopy).not.toMatch(/重新发送|执行授权已更新/);
    expect(softCopy).toBe("");
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
