import { describe, expect, it } from "vitest";
import {
  assertConversationTaskAccess,
  assertDetectionScope,
  type ConversationTaskAccess,
} from "./acl.js";
import { ConversationTaskAccessError } from "./errors.js";

function access(over: Partial<ConversationTaskAccess> = {}): ConversationTaskAccess {
  return {
    tenantId: "tenant-a",
    conversationId: "conv-1",
    requesterId: "user-1",
    authorizedConversationIds: new Set(["conv-1"]),
    employeeScopeAllowed: true,
    ...over,
  };
}

describe("assertConversationTaskAccess (fail-closed)", () => {
  it("passes for a fully valid, in-scope context", () => {
    expect(() => assertConversationTaskAccess(access())).not.toThrow();
  });

  it("rejects a missing tenant", () => {
    expect(() => assertConversationTaskAccess(access({ tenantId: "" }))).toThrow(/tenant_scope/);
  });

  it("rejects a missing requester", () => {
    expect(() => assertConversationTaskAccess(access({ requesterId: "  " }))).toThrow(
      /requester_scope/,
    );
  });

  it("rejects a conversation outside the authorized set", () => {
    expect(() =>
      assertConversationTaskAccess(access({ authorizedConversationIds: new Set(["other"]) })),
    ).toThrow(ConversationTaskAccessError);
  });

  it("rejects a denied employee/workbench scope", () => {
    expect(() => assertConversationTaskAccess(access({ employeeScopeAllowed: false }))).toThrow(
      /employee_scope/,
    );
  });
});

describe("assertDetectionScope (secondary scope check, defense in depth)", () => {
  it("passes when the message is from the bound, authorized conversation", () => {
    expect(() => assertDetectionScope(access(), "conv-1")).not.toThrow();
  });

  it("rejects a message from another conversation", () => {
    expect(() => assertDetectionScope(access(), "conv-2")).toThrow(/detection_scope/);
  });

  it("rejects a message whose conversation is not authorized", () => {
    const ctx = access({
      conversationId: "conv-9",
      authorizedConversationIds: new Set(["conv-1"]),
    });
    expect(() => assertDetectionScope(ctx, "conv-9")).toThrow(/detection_scope/);
  });
});
