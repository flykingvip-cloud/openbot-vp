import { beforeEach, describe, expect, it, vi } from "vitest";

const listCandidateCapsules = vi.fn();
const approveCandidateCapsule = vi.fn();
const rejectCandidateCapsule = vi.fn();

vi.mock("../collaboration-learning/capsule-governance.js", () => ({
  listCandidateCapsules: (...args: unknown[]) => listCandidateCapsules(...args),
  approveCandidateCapsule: (...args: unknown[]) => approveCandidateCapsule(...args),
  rejectCandidateCapsule: (...args: unknown[]) => rejectCandidateCapsule(...args),
}));

const { collaborationLearningHandlers } = await import("./collaboration-learning.js");

async function invoke(
  method: keyof typeof collaborationLearningHandlers,
  params: unknown,
  client: unknown = { connect: { client: { id: "peter" } } },
) {
  const respond = vi.fn();
  await collaborationLearningHandlers[method]({
    req: {} as never,
    params: params as never,
    respond: respond as never,
    context: {} as never,
    client: client as never,
    isWebchatConnect: () => false,
  });
  return respond;
}

beforeEach(() => {
  listCandidateCapsules.mockReset();
  approveCandidateCapsule.mockReset();
  rejectCandidateCapsule.mockReset();
});

describe("capsule governance RPC registration", () => {
  const CAPSULE_METHODS = [
    "collaboration.learning.capsule-candidates.list",
    "collaboration.learning.capsule.approve",
    "collaboration.learning.capsule.reject",
  ] as const;

  it("registers a handler for every declared method (dispatchable, not orphaned)", async () => {
    const { listGatewayMethods } = await import("../server-methods-list.js");
    const declared = new Set(listGatewayMethods());
    for (const method of CAPSULE_METHODS) {
      expect(declared.has(method), `${method} missing from the gateway method list`).toBe(true);
      expect(Object.hasOwn(collaborationLearningHandlers, method), `${method} has no handler`).toBe(
        true,
      );
    }
  });

  it("scopes reads to read and mutations to write (approve/reject are not readable)", async () => {
    const { getMethodScopeGroups, READ_SCOPE, WRITE_SCOPE } = await import("../method-scopes.js");
    const groups = getMethodScopeGroups();
    const scopeOf = (method: string): string => {
      for (const [scope, methods] of Object.entries(groups)) {
        if (methods.includes(method)) {
          return scope;
        }
      }
      return "UNSCOPED";
    };
    expect(scopeOf("collaboration.learning.capsule-candidates.list")).toBe(READ_SCOPE);
    expect(scopeOf("collaboration.learning.capsule.approve")).toBe(WRITE_SCOPE);
    expect(scopeOf("collaboration.learning.capsule.reject")).toBe(WRITE_SCOPE);
  });
});

describe("collaboration.learning.capsule-candidates.list", () => {
  it("returns pending candidates", async () => {
    listCandidateCapsules.mockResolvedValue([{ capsuleId: "cap-1" }]);
    const respond = await invoke("collaboration.learning.capsule-candidates.list", {
      groupId: "agent:daibai",
    });
    expect(listCandidateCapsules).toHaveBeenCalledWith({ groupId: "agent:daibai" });
    expect(respond).toHaveBeenCalledWith(true, { candidates: [{ capsuleId: "cap-1" }] }, undefined);
  });

  it("rejects a missing groupId", async () => {
    const respond = await invoke("collaboration.learning.capsule-candidates.list", {});
    expect(listCandidateCapsules).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
  });
});

describe("collaboration.learning.capsule.approve", () => {
  it("approves with the resolved actor", async () => {
    approveCandidateCapsule.mockResolvedValue({
      capsuleId: "cap-1",
      approved: true,
      promoted: true,
      reason: "promoted",
      assetId: "asset-1",
    });
    const respond = await invoke("collaboration.learning.capsule.approve", {
      groupId: "agent:daibai",
      capsuleId: "cap-1",
    });
    expect(approveCandidateCapsule).toHaveBeenCalledWith({
      groupId: "agent:daibai",
      capsuleId: "cap-1",
      actorId: "peter",
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ approved: true, promoted: true, assetId: "asset-1" }),
      undefined,
    );
  });

  it("refuses to approve without an identified actor (no anonymous self-approval)", async () => {
    const respond = await invoke(
      "collaboration.learning.capsule.approve",
      { groupId: "agent:daibai", capsuleId: "cap-1" },
      null,
    );
    expect(approveCandidateCapsule).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
  });

  it("surfaces governance failures as errors", async () => {
    approveCandidateCapsule.mockResolvedValue({
      capsuleId: "cap-1",
      approved: false,
      promoted: false,
      reason: "capsule_not_found",
    });
    const respond = await invoke("collaboration.learning.capsule.approve", {
      groupId: "agent:daibai",
      capsuleId: "cap-1",
    });
    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
  });
});

describe("collaboration.learning.capsule.reject", () => {
  it("rejects with reason and actor", async () => {
    rejectCandidateCapsule.mockResolvedValue({
      capsuleId: "cap-1",
      rejected: true,
      reason: "rejected",
    });
    const respond = await invoke("collaboration.learning.capsule.reject", {
      groupId: "agent:daibai",
      capsuleId: "cap-1",
      reason: "重复经验",
    });
    expect(rejectCandidateCapsule).toHaveBeenCalledWith({
      groupId: "agent:daibai",
      capsuleId: "cap-1",
      reason: "重复经验",
      actorId: "peter",
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ rejected: true }),
      undefined,
    );
  });

  it("requires an identified actor", async () => {
    const respond = await invoke(
      "collaboration.learning.capsule.reject",
      { groupId: "agent:daibai", capsuleId: "cap-1" },
      null,
    );
    expect(rejectCandidateCapsule).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
  });
});
