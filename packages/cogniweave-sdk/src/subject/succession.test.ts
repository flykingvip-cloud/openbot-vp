import { describe, expect, it } from "vitest";
import {
  computeIngestionChecksum,
  computeWriteOperationKey,
  createMemoryPartitionKeyV1,
} from "../keys.js";
import type { MemorySubjectBinding, Scope } from "../models.js";
import {
  authorizeMemoryAccess,
  createMemorySubjectBinding,
  resolveLocalMemorySubject,
} from "./binding.js";
import { applySeatMemorySuccession, resolveSeatMemoryScopeId } from "./succession.js";

const scope: Scope = {
  workspaceId: "ws_seat",
  projectId: "proj_seat",
  agentId: "agent_main",
  visibility: "private",
};

function bindingFor(params: {
  partitionDataPlaneId: string;
  subject: MemorySubjectBinding["subject"];
  scopeType?: MemorySubjectBinding["scopeType"];
  scopeOverride?: Scope;
}): MemorySubjectBinding {
  const partition = createMemoryPartitionKeyV1(
    params.partitionDataPlaneId,
    params.scopeOverride ?? scope,
  );
  return createMemorySubjectBinding({
    partition,
    scope: params.scopeOverride ?? scope,
    subject: params.subject,
    scopeType: params.scopeType,
    now: "2026-07-19T10:00:00.000Z",
  });
}

describe("CW2-P3-02 seat memory succession", () => {
  const tenantId = "tenant_succ";
  const seatId = "seat_42";
  const seatScopeId = resolveSeatMemoryScopeId(seatId);
  const privateScopeId = "user:outgoing:private";
  const reviewScopeId = "project:crm";
  const outgoing = "user_out";
  const incoming = "user_in";

  const resolveScopeId = (binding: MemorySubjectBinding): string | undefined => {
    if (binding.subject.ownerType === "seat" && binding.subject.ownerId === seatId) {
      return seatScopeId;
    }
    if (binding.scopeType === "personal") {
      return privateScopeId;
    }
    if (binding.scopeType === "space") {
      return reviewScopeId;
    }
    if (binding.scopeType === "seat") {
      return seatScopeId;
    }
    return undefined;
  };

  it("never leaks private scopes to the successor", () => {
    const partition = createMemoryPartitionKeyV1("dp_private", scope);
    const seatBinding = bindingFor({
      partitionDataPlaneId: "dp_private",
      subject: { tenantId, ownerType: "seat", ownerId: seatId },
      scopeType: "seat",
    });
    const privateUser = createMemorySubjectBinding({
      partition,
      scope,
      subject: { tenantId, ownerType: "user", ownerId: outgoing },
      scopeType: "personal",
      now: "2026-07-19T10:00:00.000Z",
    });

    const result = applySeatMemorySuccession({
      bindings: [seatBinding, privateUser],
      tenantId,
      seatId,
      outgoingUserId: outgoing,
      incomingUserId: incoming,
      scopes: [
        { scopeId: seatScopeId, transferClass: "inheritable" },
        { scopeId: privateScopeId, transferClass: "private" },
      ],
      resolveScopeId,
      now: "2026-07-19T12:00:00.000Z",
    });

    expect(result.skippedPrivateScopeIds).toEqual([privateScopeId]);
    expect(result.createdBindingIds).toEqual([]);
    expect(result.preservedSeatBindingIds).toContain(seatBinding.id);
    expect(result.bindings.find((row) => row.id === privateUser.id)?.unboundAt).toBe(
      "2026-07-19T12:00:00.000Z",
    );

    const auth = authorizeMemoryAccess(result.bindings, {
      partition,
      caller: { tenantId, ownerType: "user", ownerId: incoming },
    });
    expect(auth).toEqual({ allowed: false, reason: "OWNER_MISMATCH" });
  });

  it("inherits inheritable user bindings and preserves seat ownership", () => {
    const inheritableUser = bindingFor({
      partitionDataPlaneId: "dp_inherit",
      subject: { tenantId, ownerType: "user", ownerId: outgoing },
      scopeType: "seat",
    });
    const seatBinding = bindingFor({
      partitionDataPlaneId: "dp_inherit",
      subject: { tenantId, ownerType: "seat", ownerId: seatId },
      scopeType: "seat",
    });

    const result = applySeatMemorySuccession({
      bindings: [inheritableUser, seatBinding],
      tenantId,
      seatId,
      outgoingUserId: outgoing,
      incomingUserId: incoming,
      scopes: [{ scopeId: seatScopeId, transferClass: "inheritable" }],
      resolveScopeId,
      now: "2026-07-19T12:00:00.000Z",
    });

    expect(result.unboundBindingIds).toEqual([inheritableUser.id]);
    expect(result.createdBindingIds).toHaveLength(1);
    expect(result.preservedSeatBindingIds).toEqual([seatBinding.id]);
    expect(seatBinding.unboundAt).toBeUndefined();
    expect(result.bindings.find((row) => row.id === seatBinding.id)?.unboundAt).toBeUndefined();

    const successor = result.bindings.find((row) => row.id === result.createdBindingIds[0]);
    expect(successor?.subject).toEqual({
      tenantId,
      ownerType: "user",
      ownerId: incoming,
    });

    const partition = createMemoryPartitionKeyV1("dp_inherit", scope);
    expect(
      authorizeMemoryAccess(result.bindings, {
        partition,
        caller: { tenantId, ownerType: "user", ownerId: incoming },
      }),
    ).toMatchObject({ allowed: true });
    expect(
      authorizeMemoryAccess(result.bindings, {
        partition,
        caller: { tenantId, ownerType: "user", ownerId: outgoing },
      }),
    ).toEqual({ allowed: false, reason: "OWNER_MISMATCH" });
  });

  it("requires confirmation for review_required scopes", () => {
    const reviewUser = bindingFor({
      partitionDataPlaneId: "dp_review",
      subject: { tenantId, ownerType: "user", ownerId: outgoing },
      scopeType: "space",
    });
    const scopes = [{ scopeId: reviewScopeId, transferClass: "review_required" as const }];

    const denied = applySeatMemorySuccession({
      bindings: [reviewUser],
      tenantId,
      seatId,
      outgoingUserId: outgoing,
      incomingUserId: incoming,
      scopes,
      resolveScopeId,
      now: "2026-07-19T12:00:00.000Z",
    });
    expect(denied.createdBindingIds).toEqual([]);
    expect(denied.skippedReviewScopeIds).toEqual([reviewScopeId]);

    const approved = applySeatMemorySuccession({
      bindings: [reviewUser],
      tenantId,
      seatId,
      outgoingUserId: outgoing,
      incomingUserId: incoming,
      scopes,
      confirmedScopeIds: [reviewScopeId],
      resolveScopeId,
      now: "2026-07-19T12:00:00.000Z",
    });
    expect(approved.createdBindingIds).toHaveLength(1);
    expect(approved.skippedReviewScopeIds).toEqual([]);
  });

  it("keeps writeOperationKey stable and does not invent local subjects", () => {
    const partition = createMemoryPartitionKeyV1("dp_opkey", scope);
    const contentChecksum = computeIngestionChecksum("succ-body", {
      openbotPath: "/tmp/succ.jsonl",
    });
    const before = computeWriteOperationKey({
      partition,
      sourceType: "chat",
      sourceLocator: "/tmp/succ.jsonl",
      contentChecksum,
    });

    const userBinding = createMemorySubjectBinding({
      partition,
      scope,
      subject: { tenantId, ownerType: "user", ownerId: outgoing },
      scopeType: "seat",
    });
    applySeatMemorySuccession({
      bindings: [userBinding],
      tenantId,
      seatId,
      outgoingUserId: outgoing,
      incomingUserId: incoming,
      scopes: [{ scopeId: seatScopeId, transferClass: "inheritable" }],
      resolveScopeId,
    });

    const after = computeWriteOperationKey({
      partition,
      sourceType: "chat",
      sourceLocator: "/tmp/succ.jsonl",
      contentChecksum,
    });
    expect(after).toBe(before);
    // Local sentinel helper remains independent of enterprise succession.
    expect(resolveLocalMemorySubject("agent_main").tenantId).toBe("__local__");
  });
});
