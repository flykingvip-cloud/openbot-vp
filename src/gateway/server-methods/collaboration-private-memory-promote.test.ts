import { beforeEach, describe, expect, it, vi } from "vitest";

const promoteAuthorizedMock = vi.fn();
const resolveDeliveryAclActor = vi.fn();
const resolveCollaborationTenantResolution = vi.fn();
const resolveHandlerTrustedTeamContext = vi.fn();
const loadConfig = vi.fn();

vi.mock("../collaboration-learning/private-memory-promote-entry.js", () => ({
  promotePrivateMemoryCapsuleAuthorized: (...args: unknown[]) => promoteAuthorizedMock(...args),
}));

vi.mock("../collaboration-learning/delivery-actor-binding.js", () => ({
  resolveDeliveryAclActor: (...args: unknown[]) => resolveDeliveryAclActor(...args),
  authenticatedSessionSubjects: () => [],
}));

vi.mock("../collaboration-learning/trusted-tenant.js", () => ({
  resolveCollaborationTenantResolution: (...args: unknown[]) =>
    resolveCollaborationTenantResolution(...args),
}));

vi.mock("../collaboration-learning/team-resource-auth.js", () => ({
  resolveHandlerTrustedTeamContext: (...args: unknown[]) =>
    resolveHandlerTrustedTeamContext(...args),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: (...args: unknown[]) => loadConfig(...args),
}));

// Keep other collaboration-learning.js surface light for handler import.
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
  client: unknown = { connect: { client: { id: "owner-user" } } },
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
  promoteAuthorizedMock.mockReset();
  resolveDeliveryAclActor.mockReset();
  resolveCollaborationTenantResolution.mockReset();
  resolveHandlerTrustedTeamContext.mockReset();
  loadConfig.mockReset();
  resolveDeliveryAclActor.mockResolvedValue("owner-user");
  resolveCollaborationTenantResolution.mockResolvedValue({
    tenantId: null,
    trust: "none",
  });
  resolveHandlerTrustedTeamContext.mockResolvedValue({
    ok: true,
    auth: { profile: "personal_local", tenantId: null },
    stores: { learningStorage: { marker: "trusted-stores" } },
    trusted: { groupsRoot: "/tmp/groups", groupLocator: "/tmp/groups/group-1" },
  });
  loadConfig.mockReturnValue({
    collaboration: { learning: { privateMemoryPromote: true } },
  });
});

describe("privateMemory.promote RPC registration", () => {
  const METHOD = "collaboration.learning.privateMemory.promote" as const;

  it("registers handler and lists method under write scope", async () => {
    const { listGatewayMethods } = await import("../server-methods-list.js");
    const declared = new Set(listGatewayMethods());
    expect(declared.has(METHOD)).toBe(true);
    expect(Object.hasOwn(collaborationLearningHandlers, METHOD)).toBe(true);

    const { getMethodScopeGroups, WRITE_SCOPE } = await import("../method-scopes.js");
    const groups = getMethodScopeGroups();
    expect(groups[WRITE_SCOPE]).toContain(METHOD);
  });
});

describe("collaboration.learning.privateMemory.promote", () => {
  const METHOD = "collaboration.learning.privateMemory.promote" as const;

  it("invokes authorized promote when flag ON and membership ok", async () => {
    promoteAuthorizedMock.mockResolvedValue({
      capsuleId: "cap-1",
      promoted: true,
      reason: "promoted",
      assetId: "asset-1",
      sourceScopeId: "agent:bot-a",
      groupId: "group-1",
    });

    const respond = await invoke(METHOD, {
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-1",
    });

    expect(promoteAuthorizedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "bot-a",
        groupId: "group-1",
        capsuleId: "cap-1",
        actorId: "owner-user",
        tenantId: null,
        securityProfile: "personal_local",
        stores: expect.objectContaining({
          learningStorage: expect.anything(),
        }),
        cfg: expect.objectContaining({
          collaboration: { learning: { privateMemoryPromote: true } },
        }),
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ promoted: true, assetId: "asset-1" }),
      undefined,
    );
  });

  it("returns success-shaped flag_off when promote reports flag_off", async () => {
    promoteAuthorizedMock.mockResolvedValue({
      capsuleId: "cap-1",
      promoted: false,
      reason: "flag_off",
      sourceScopeId: "agent:bot-a",
      groupId: "group-1",
    });
    const respond = await invoke(METHOD, {
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-1",
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ promoted: false, reason: "flag_off" }),
      undefined,
    );
  });

  it("refuses without identified actor", async () => {
    resolveDeliveryAclActor.mockResolvedValue(undefined);
    const respond = await invoke(METHOD, {
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-1",
    });
    expect(promoteAuthorizedMock).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
  });

  it("refuses non-member (trusted write fails) without promote", async () => {
    resolveHandlerTrustedTeamContext.mockResolvedValue({
      ok: false,
      reason: "not_a_member",
      detail: "observer",
    });
    const respond = await invoke(METHOD, {
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-1",
    });
    expect(promoteAuthorizedMock).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
  });

  it("surfaces ownership / missing-capsule as RPC errors (no false promote success)", async () => {
    promoteAuthorizedMock.mockResolvedValue({
      capsuleId: "cap-1",
      promoted: false,
      reason: "actor_not_owner",
      sourceScopeId: "agent:bot-a",
      groupId: "group-1",
    });
    const respond = await invoke(METHOD, {
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-1",
    });
    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
  });
});
