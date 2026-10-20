import { beforeEach, describe, expect, it, vi } from "vitest";
import { listDataCapabilitiesForAgent } from "../../gateway/enterprise-data/capability-agent-invoke-runtime.js";
import { listOperationalIdentityRuntimeAccess } from "../../gateway/enterprise-operational-identity-runtime.js";
import { resolveDaibaiWorkspaceScopePrompt } from "../../gateway/server-methods/daibai-workspace-overview.js";
import { listUserOperationalIdentityRuntimeAccess } from "../../gateway/user-operational-identity-runtime.js";
import { buildOperationalIdentitySystemPrompt } from "./operational-identity-context.js";

vi.mock("../../gateway/enterprise-data/capability-agent-invoke-runtime.js", () => ({
  formatAgentDataCapabilityRuntimePrompt: vi.fn().mockReturnValue("data-caps"),
  listDataCapabilitiesForAgent: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../gateway/enterprise-operational-identity-runtime.js", () => ({
  formatOperationalIdentityRuntimePrompt: vi.fn().mockReturnValue("enterprise-identity"),
  listOperationalIdentityRuntimeAccess: vi.fn().mockResolvedValue({ entries: [{}] }),
}));

vi.mock("../../gateway/knowledge/publish-intent.js", () => ({
  formatKnowledgePublishIntentExecutionSystemPrompt: vi.fn().mockReturnValue("publish"),
  parseKnowledgePublishIntentFromMessage: vi.fn().mockReturnValue(null),
}));

vi.mock("../../gateway/knowledge/reply-gateway-client.js", () => ({
  buildKnowledgeReplyGatewayClient: vi.fn().mockReturnValue({ sessionDomain: "employee" }),
}));

vi.mock("../../gateway/server-methods/daibai-workspace-overview.js", () => ({
  resolveDaibaiWorkspaceScopePrompt: vi.fn().mockResolvedValue("workspace-scope"),
}));

vi.mock("../../gateway/user-operational-identity-guidance.js", () => ({
  formatPersonalEmailSendGuidancePrompt: vi.fn().mockReturnValue("email-guidance"),
}));

vi.mock("../../gateway/user-operational-identity-runtime.js", () => ({
  formatUserOperationalIdentityRuntimePrompt: vi.fn().mockReturnValue("user-identity"),
  listUserOperationalIdentityRuntimeAccess: vi.fn().mockResolvedValue({ entries: [{}] }),
}));

const EMPLOYEE_SESSION_KEY = "agent:main:employee:c7f8e59e-4705-4fe0-a763-5fa62d66e6f2";

describe("buildOperationalIdentitySystemPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lightweight mode keeps steward ACL and loads minimal user identity only", async () => {
    const prompt = await buildOperationalIdentitySystemPrompt({
      agentId: "main",
      sessionKey: EMPLOYEE_SESSION_KEY,
      inboundMessage: "晚上好",
      listingMode: "lightweight",
      gatewayClientPlatformUserId: "c7f8e59e-4705-4fe0-a763-5fa62d66e6f2",
    });
    expect(prompt).toEqual(expect.stringContaining("大白"));
    expect(prompt).toEqual(expect.stringContaining("email-guidance"));
    expect(prompt).toEqual(expect.stringContaining("user-identity"));
    expect(vi.mocked(listOperationalIdentityRuntimeAccess)).not.toHaveBeenCalled();
    expect(vi.mocked(listUserOperationalIdentityRuntimeAccess)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listDataCapabilitiesForAgent)).not.toHaveBeenCalled();
    expect(vi.mocked(resolveDaibaiWorkspaceScopePrompt)).not.toHaveBeenCalled();
  });

  it("full mode still lists enterprise and personal identities when the chat session has no gateway client", async () => {
    const { buildKnowledgeReplyGatewayClient } =
      await import("../../gateway/knowledge/reply-gateway-client.js");
    vi.mocked(buildKnowledgeReplyGatewayClient).mockReturnValueOnce(null);
    const prompt = await buildOperationalIdentitySystemPrompt({
      agentId: "bot--agent",
      sessionKey: "agent:bot--agent:main",
      inboundMessage: "帮我预定腾讯会议",
    });
    expect(vi.mocked(listOperationalIdentityRuntimeAccess)).toHaveBeenCalledWith({
      client: null,
      agentId: "bot--agent",
    });
    expect(vi.mocked(listUserOperationalIdentityRuntimeAccess)).toHaveBeenCalledWith({
      client: null,
      agentId: "bot--agent",
      sessionKey: "agent:bot--agent:main",
    });
    expect(prompt).toEqual(expect.stringContaining("enterprise-identity"));
    expect(prompt).toEqual(expect.stringContaining("user-identity"));
  });

  it("full mode still loads workspace scope, identity and data capability listings", async () => {
    const prompt = await buildOperationalIdentitySystemPrompt({
      agentId: "main",
      sessionKey: EMPLOYEE_SESSION_KEY,
      inboundMessage: "查询知识库里的差旅政策",
      gatewayClient: { sessionDomain: "employee" } as never,
      gatewayClientPlatformUserId: "c7f8e59e-4705-4fe0-a763-5fa62d66e6f2",
    });
    expect(prompt).toEqual(expect.stringContaining("workspace-scope"));
    expect(vi.mocked(listOperationalIdentityRuntimeAccess)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listUserOperationalIdentityRuntimeAccess)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listDataCapabilitiesForAgent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveDaibaiWorkspaceScopePrompt)).toHaveBeenCalledTimes(1);
  });
});
