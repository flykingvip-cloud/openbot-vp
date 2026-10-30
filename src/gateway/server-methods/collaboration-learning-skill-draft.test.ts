import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const finalizeMock = vi.fn();
const resolveOwnerIds = vi.fn();

vi.mock("../collaboration-learning/learning-skill-draft-entry.js", () => ({
  listLearningCuratedSkillDrafts: (...args: unknown[]) => listMock(...args),
  finalizeLearningCuratedSkillDraft: (...args: unknown[]) => finalizeMock(...args),
}));

vi.mock("../personal-skill-asset-scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../personal-skill-asset-scope.js")>();
  return {
    ...actual,
    resolvePersonalAssetOwnerIdentities: (...args: unknown[]) => resolveOwnerIds(...args),
  };
});

vi.mock("../collaboration-learning/delivery-actor-binding.js", () => ({
  resolveDeliveryAclActor: vi.fn(),
  authenticatedSessionSubjects: () => [],
}));

vi.mock("../collaboration-learning/trusted-tenant.js", () => ({
  resolveCollaborationTenantResolution: vi.fn(async () => ({ tenantId: null, trust: "none" })),
}));

vi.mock("../collaboration-learning/team-resource-auth.js", () => ({
  resolveHandlerTrustedTeamContext: vi.fn(async () => ({
    ok: true,
    auth: {},
    stores: {},
    trusted: {},
  })),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../collaboration-learning.js", () => ({
  loadGatewayCollaborationLearningSnapshot: vi.fn(),
  resolveCollaborationTransitionError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ClaimContractEntryError: class ClaimContractEntryError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  WakeOpGatewayRecoveryEntryError: class WakeOpGatewayRecoveryEntryError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  acceptCollaborationTaskHandoffContract: vi.fn(),
  applyCollaborationTaskHandoffContract: vi.fn(),
  approveCollaborationTaskHandoffContract: vi.fn(),
  handoffCollaborationTask: vi.fn(),
  proposeCollaborationTaskHandoffContract: vi.fn(),
  publishCollaborationBoardItem: vi.fn(),
  claimCollaborationBoardItem: vi.fn(),
  applyCollaborationBoardClaim: vi.fn(),
  listCollaborationBoardItems: vi.fn(),
  getCollaborationBoardMemberProgress: vi.fn(),
  markCollaborationBoardItemInProgress: vi.fn(),
  submitCollaborationBoardItemForReview: vi.fn(),
  acceptCollaborationBoardItemSubmission: vi.fn(),
  returnCollaborationBoardItemSubmission: vi.fn(),
  recordCollaborationBoardItemPeerReview: vi.fn(),
  listCollaborationPeerReviews: vi.fn(),
  openCollaborationChallengeWindow: vi.fn(),
  recordCollaborationChallengeCritique: vi.fn(),
  resolveCollaborationChallengeWindow: vi.fn(),
  skipCollaborationChallengeWindow: vi.fn(),
  listCollaborationChallengeWindows: vi.fn(),
  blockCollaborationBoardItem: vi.fn(),
  unblockCollaborationBoardItem: vi.fn(),
  cancelCollaborationBoardItem: vi.fn(),
  listCollaborationWakeEvents: vi.fn(),
  getCollaborationWhoWokeWhom: vi.fn(),
  runCollaborationGroupTaskHeartbeat: vi.fn(),
  runCollaborationSelfAdvance: vi.fn(),
  getCollaborationAdminDailySummary: vi.fn(),
  proposeCollaborationTodolist: vi.fn(),
  retryCollaborationOwnerDecisionDelivery: vi.fn(),
  listCollaborationOwnerDecisionDeliveries: vi.fn(),
  confirmCollaborationTodolist: vi.fn(),
  reviseCollaborationTodolist: vi.fn(),
  getCollaborationTodolist: vi.fn(),
  listCollaborationTodolists: vi.fn(),
  buildCollaborationExecutionTaskBag: vi.fn(),
  signalCollaborationInsight: vi.fn(),
  transitionCollaborationDecision: vi.fn(),
  transitionCollaborationDeliverable: vi.fn(),
  transitionCollaborationReview: vi.fn(),
  transitionCollaborationTask: vi.fn(),
  requestCollaborationTaskStop: vi.fn(),
  releaseWakeOpForRetryViaGatewaySession: vi.fn(),
  confirmWakeOpCompletedViaGatewaySession: vi.fn(),
  updateCollaborationDecisionDraft: vi.fn(),
}));

vi.mock("../collaboration-learning/capsule-governance.js", () => ({
  approveCandidateCapsule: vi.fn(),
  listCandidateCapsules: vi.fn(),
  rejectCandidateCapsule: vi.fn(),
  transitionGroupMemoryCapsule: vi.fn(),
}));

vi.mock("../collaboration-learning/capsule-promotion.js", () => ({
  promoteApprovedCapsuleIfEligible: vi.fn(),
}));

vi.mock("../collaboration-learning/post-plan-confirm-advance.js", () => ({
  triggerPostPlanConfirmAdvance: vi.fn(),
}));

vi.mock("../collaboration-learning/private-memory-promote-entry.js", () => ({
  promotePrivateMemoryCapsuleAuthorized: vi.fn(),
}));

vi.mock("../collaboration-ledger/reader.js", () => ({
  readCollaborationLedgerArchive: vi.fn(),
}));

vi.mock("../collaboration-dispatch/runtime-namespace.js", () => ({
  isCollabRuntimeNamespaceEnabled: () => false,
}));

const { collaborationLearningHandlers } = await import("./collaboration-learning.js");

async function invoke(
  method: keyof typeof collaborationLearningHandlers,
  params: unknown,
  client: unknown = { user: "owner@example.com", connect: { client: { id: "ui" } } },
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
  listMock.mockReset();
  finalizeMock.mockReset();
  resolveOwnerIds.mockReset();
  resolveOwnerIds.mockResolvedValue(["owner@example.com"]);
});

describe("skillDraft RPC registration", () => {
  it("registers list (read) and finalize (write)", async () => {
    const { listGatewayMethods } = await import("../server-methods-list.js");
    const declared = new Set(listGatewayMethods());
    expect(declared.has("collaboration.learning.skillDraft.list")).toBe(true);
    expect(declared.has("collaboration.learning.skillDraft.finalize")).toBe(true);
    expect(
      Object.hasOwn(collaborationLearningHandlers, "collaboration.learning.skillDraft.list"),
    ).toBe(true);
    expect(
      Object.hasOwn(collaborationLearningHandlers, "collaboration.learning.skillDraft.finalize"),
    ).toBe(true);

    const { getMethodScopeGroups, WRITE_SCOPE, READ_SCOPE } = await import("../method-scopes.js");
    const groups = getMethodScopeGroups();
    expect(groups[READ_SCOPE]).toContain("collaboration.learning.skillDraft.list");
    expect(groups[WRITE_SCOPE]).toContain("collaboration.learning.skillDraft.finalize");
  });
});

describe("collaboration.learning.skillDraft.list", () => {
  it("returns owned drafts for authenticated caller", async () => {
    listMock.mockReturnValue([{ id: "skill-1", lifecycle: "draft" }]);
    const respond = await invoke("collaboration.learning.skillDraft.list", {});
    expect(listMock).toHaveBeenCalledWith(["owner@example.com"]);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ skills: [{ id: "skill-1", lifecycle: "draft" }] }),
      undefined,
    );
  });

  it("refuses unauthenticated callers", async () => {
    resolveOwnerIds.mockResolvedValue([]);
    const respond = await invoke("collaboration.learning.skillDraft.list", {});
    expect(listMock).not.toHaveBeenCalled();
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });
});

describe("collaboration.learning.skillDraft.finalize", () => {
  it("finalizes via entry for authenticated owner", async () => {
    finalizeMock.mockReturnValue({
      skill: { id: "skill-1", lifecycle: "private" },
      nextLifecycle: "private",
      nextStep: "robot-skills.install",
    });
    const respond = await invoke("collaboration.learning.skillDraft.finalize", {
      skillId: "skill-1",
    });
    expect(finalizeMock).toHaveBeenCalledWith({
      skillId: "skill-1",
      ownerIds: ["owner@example.com"],
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ nextLifecycle: "private", nextStep: "robot-skills.install" }),
      undefined,
    );
  });

  it("requires skillId", async () => {
    const respond = await invoke("collaboration.learning.skillDraft.finalize", {});
    expect(finalizeMock).not.toHaveBeenCalled();
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });
});
