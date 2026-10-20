// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listEnterpriseKnowledgeProjectionBindings } from "../../gateway/enterprise-data/enterprise-knowledge-projection-binding-store.js";
import { runProjectionMaterialization } from "../../gateway/enterprise-data/projection-materializer.js";
import { seedEnterpriseDataCatalog } from "../../gateway/enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore } from "../../gateway/enterprise-data/store.js";
import type { EnterpriseDataStore } from "../../gateway/enterprise-data/types.js";
import { runPreparedReply } from "./get-reply-run.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

async function buildSeededEnterpriseStore(): Promise<EnterpriseDataStore> {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  const binding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find((item) => {
    const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
    return spec?.projectionKey === "customer.profile";
  });
  if (binding) {
    await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding.bindingId,
      nowIso,
    });
  }
  return store;
}

let enterpriseStore!: EnterpriseDataStore;

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    gateway: { auth: { trustedProxy: { enabled: true } } },
    session: {},
    channels: {},
    agents: { defaults: {} },
  }),
}));

vi.mock("../../gateway/platform-auth.js", () => ({
  resolvePlatformAuthConfig: () => ({ enabled: true }),
  // Realistic store shape: the authoritative resolver validates normalizedEmail,
  // user status, a single unambiguous membership, and enterprise availability.
  loadPlatformAuthStore: async () => ({
    users: {
      "user-mgr-001": {
        id: "user-mgr-001",
        email: "mgr@acme.test",
        normalizedEmail: "mgr@acme.test",
        status: "active",
      },
    },
    memberships: {
      "mem-1": {
        id: "mem-1",
        userId: "user-mgr-001",
        enterpriseId: tenantId,
        membershipRole: "member",
      },
    },
    enterprises: { [tenantId]: { id: tenantId, status: "paid" } },
  }),
  findUserByEmail: (_store: unknown, email: string) =>
    email === "mgr@acme.test" ? { id: "user-mgr-001", email } : null,
}));

vi.mock("../../gateway/enterprise-seat-assets-store.js", () => ({
  loadEnterpriseSeatAssetsStore: async () => ({
    seats: {
      "seat-sales-mgr-east": {
        seatId: "seat-sales-mgr-east",
        tenantId,
        title: "华东销售经理",
        teamLabel: "华东销售",
        roleCode: "sales-mgr",
        status: "occupied",
        currentEmployeeId: "user-mgr-001",
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    bindings: {
      "bind-1": {
        bindingId: "bind-1",
        seatId: "seat-sales-mgr-east",
        tenantId,
        employeeId: "user-mgr-001",
        bindingStatus: "active",
        effectiveAt: nowIso,
      },
    },
  }),
}));

vi.mock("../../gateway/enterprise-data/store.js", async () => {
  const actual = await vi.importActual<typeof import("../../gateway/enterprise-data/store.js")>(
    "../../gateway/enterprise-data/store.js",
  );
  return {
    ...actual,
    loadEnterpriseDataStore: async () => enterpriseStore,
  };
});

vi.mock("../../agents/auth-profiles/session-override.js", () => ({
  resolveSessionAuthProfileOverride: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunActive: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunStreaming: vi.fn().mockReturnValue(false),
  resolveEmbeddedSessionLane: vi.fn().mockReturnValue("session:session-key"),
}));

vi.mock("../../config/sessions.js", () => ({
  resolveGroupSessionKey: vi.fn().mockReturnValue(undefined),
  resolveSessionFilePath: vi.fn().mockReturnValue("/tmp/session.jsonl"),
  resolveSessionFilePathOptions: vi.fn().mockReturnValue({}),
  updateSessionStore: vi.fn(),
}));

vi.mock("../../globals.js", () => ({
  logVerbose: vi.fn(),
}));

vi.mock("../../organization/runtime.js", () => ({
  resolveRuntimeOrganizationContext: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../organization/coordinator-authority.js", () => ({
  resolveCoordinatorAuthority: vi.fn().mockReturnValue({
    shouldAvoidDirectUserCoordination: false,
  }),
}));

vi.mock("../../process/command-queue.js", () => ({
  clearCommandLane: vi.fn().mockReturnValue(0),
  getQueueSize: vi.fn().mockReturnValue(0),
}));

// Partial mock: keep the module's other exports (for example DEFAULT_ACCOUNT_ID,
// which src/web/auth-store.ts reads at import time) instead of dropping them.
vi.mock("../../routing/session-key.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../routing/session-key.js")>()),
  normalizeAgentId: vi.fn((value: string) => value),
  normalizeMainKey: vi.fn().mockReturnValue("main"),
}));

vi.mock("../../utils/provider-utils.js", () => ({
  isReasoningTagProvider: vi.fn().mockReturnValue(false),
}));

vi.mock("../command-detection.js", () => ({
  hasControlCommand: vi.fn().mockReturnValue(false),
}));

vi.mock("./agent-runner.js", () => ({
  runReplyAgent: vi.fn().mockResolvedValue({ text: "ok" }),
}));

vi.mock("./body.js", () => ({
  applySessionHints: vi.fn().mockImplementation(async ({ baseBody }) => baseBody),
}));

vi.mock("./collaboration-capability-context.js", () => ({
  buildCollaborationCapabilitySystemPrompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./groups.js", () => ({
  buildGroupIntro: vi.fn().mockReturnValue(""),
  buildGroupChatContext: vi.fn().mockReturnValue(""),
}));

vi.mock("./inbound-meta.js", () => ({
  buildInboundMetaSystemPrompt: vi.fn().mockReturnValue(""),
  buildInboundUserContextPrefix: vi.fn().mockReturnValue(""),
  buildCurrentSpeakerUntrustedPrompt: vi.fn().mockReturnValue(undefined),
}));

vi.mock("./queue.js", () => ({
  resolveQueueSettings: vi.fn().mockReturnValue({ mode: "followup" }),
}));

vi.mock("./route-reply.js", () => ({
  routeReply: vi.fn(),
}));

vi.mock("./context-budget-assembler.js", () => ({
  buildActiveContextSystemPrompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./session-updates.js", () => ({
  ensureSkillSnapshot: vi.fn().mockImplementation(async ({ sessionEntry, systemSent }) => ({
    sessionEntry,
    systemSent,
    skillsSnapshot: undefined,
  })),
  drainFormattedSystemEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./learning-recall-context.js", () => ({
  buildLearningRecallSystemPrompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./runtime-skill-policy.js", () => ({
  resolveRuntimeSkillPolicy: vi.fn().mockResolvedValue({ block: [] }),
}));

vi.mock("./typing-mode.js", () => ({
  resolveTypingMode: vi.fn().mockReturnValue("off"),
}));

import { runReplyAgent } from "./agent-runner.js";

describe("get-reply-run knowledge universe integration", () => {
  beforeEach(async () => {
    enterpriseStore = await buildSeededEnterpriseStore();
    vi.clearAllMocks();
  });

  it("injects enterprise knowledge universe context into extraSystemPrompt for gateway sessions", async () => {
    await runPreparedReply({
      ctx: {
        Body: "客户成交率为什么下降",
        RawBody: "客户成交率为什么下降",
        CommandBody: "客户成交率为什么下降",
        GatewayClientUser: "mgr@acme.test",
        GatewayClientSessionDomain: "employee",
      },
      sessionCtx: {
        Body: "客户成交率为什么下降",
        BodyStripped: "客户成交率为什么下降",
        Provider: "webchat",
        ChatType: "direct",
      },
      cfg: { session: {}, channels: {}, agents: { defaults: {} } },
      agentId: "employee-agent",
      agentDir: "/tmp/agent",
      agentCfg: {},
      sessionCfg: {},
      commandAuthorized: true,
      command: {
        isAuthorizedSender: true,
        abortKey: "session-key",
        ownerList: [],
        senderIsOwner: false,
      } as never,
      commandSource: "",
      allowTextCommands: true,
      directives: {
        hasThinkDirective: false,
        thinkLevel: undefined,
      } as never,
      defaultActivation: "always",
      resolvedThinkLevel: undefined,
      resolvedVerboseLevel: "off",
      resolvedReasoningLevel: "off",
      resolvedElevatedLevel: "off",
      elevatedEnabled: false,
      elevatedAllowed: false,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end",
      modelState: {
        resolveDefaultThinkingLevel: async () => "medium",
      } as never,
      provider: "anthropic",
      model: "claude-opus-4-1",
      typing: {
        onReplyStart: vi.fn().mockResolvedValue(undefined),
        cleanup: vi.fn(),
      } as never,
      defaultProvider: "anthropic",
      defaultModel: "claude-opus-4-1",
      timeoutMs: 30_000,
      isNewSession: true,
      resetTriggered: false,
      systemSent: true,
      sessionKey: "agent:employee-agent:webchat:dm:user-1",
      workspaceDir: "/tmp/workspace",
      abortedLastRun: false,
    });

    const call = vi.mocked(runReplyAgent).mock.calls.at(-1)?.[0];
    const extraSystemPrompt = call?.followupRun.run.extraSystemPrompt ?? "";
    expect(extraSystemPrompt).toContain("Knowledge Universe context");
    expect(extraSystemPrompt).toContain("Do not call external CRM/ERP/Connector APIs directly");
    expect(extraSystemPrompt).toMatch(/客户画像|客户画像能力/);
  });
});
