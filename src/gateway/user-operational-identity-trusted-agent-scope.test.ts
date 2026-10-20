import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/config.js";
import { listOwnershipRecords } from "./ownership-store.js";
import {
  buildTrustedUserOperationalIdentityAgentScopeIds,
  resolveTrustedUserOperationalIdentityAgentScope,
} from "./user-operational-identity-trusted-agent-scope.js";

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("./collaboration-learning/shared.js", () => ({
  readConfiguredAgentOwnership: vi.fn(() => null),
}));

vi.mock("./ownership-store.js", () => ({
  listOwnershipRecords: vi.fn(() => []),
}));

vi.mock("./session-utils.js", () => ({
  listAgentsForGateway: vi.fn(() => ({
    agents: [
      { id: "agent-owned-1", scope: "self" },
      { id: "agent-shared-1", scope: "shared" },
      { id: "agent-team-1", scope: "team", ownerId: "other-user" },
      { id: "agent-legacy-1" },
    ],
  })),
}));

describe("trusted user operational identity agent scope", () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({});
    vi.mocked(listOwnershipRecords).mockReturnValue([]);
  });

  it("classifies self-scoped agents as owned", () => {
    expect(
      resolveTrustedUserOperationalIdentityAgentScope({
        currentUserId: "user-1",
        agentId: "agent-owned-1",
      }),
    ).toBe("owned");
  });

  it("classifies configured shared agents as shared", () => {
    expect(
      resolveTrustedUserOperationalIdentityAgentScope({
        currentUserId: "user-1",
        agentId: "agent-shared-1",
      }),
    ).toBe("shared");
  });

  it("classifies collaboration session keys as group", () => {
    expect(
      resolveTrustedUserOperationalIdentityAgentScope({
        currentUserId: "user-1",
        agentId: "agent-shared-1",
        sessionKey: "space:team-alpha",
      }),
    ).toBe("group");
  });

  it("ignores forged owned lists by requiring server config", () => {
    const trusted = buildTrustedUserOperationalIdentityAgentScopeIds({
      currentUserId: "user-1",
      agentId: "agent-shared-1",
    });
    expect(trusted.agentScope).toBe("shared");
    expect(trusted.ownedAgentIds).toEqual([]);
    expect(trusted.sharedAgentIds).toEqual(["agent-shared-1"]);
  });

  it("matches owner email for owned agents", () => {
    expect(
      resolveTrustedUserOperationalIdentityAgentScope({
        currentUserId: "user-1",
        currentUserEmail: "owner@example.com",
        agentId: "agent-custom",
      }),
    ).toBe("shared");
  });

  it("classifies the builtin steward as owned", () => {
    expect(
      resolveTrustedUserOperationalIdentityAgentScope({
        currentUserId: "user-1",
        agentId: "main",
      }),
    ).toBe("owned");
  });

  it("classifies legacy personal agents without scope/owner as owned", () => {
    expect(
      resolveTrustedUserOperationalIdentityAgentScope({
        currentUserId: "user-1",
        agentId: "agent-legacy-1",
      }),
    ).toBe("owned");
  });

  it("classifies org-owned personal agents as owned even without config ownerId", () => {
    vi.mocked(listOwnershipRecords).mockReturnValue([
      {
        subjectKind: "agent",
        subjectId: "bot-2",
        bindingStatus: "active",
        currentManagerUserId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      } as never,
    ]);
    expect(
      resolveTrustedUserOperationalIdentityAgentScope({
        currentUserId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
        currentUserEmail: "daniel.hhd@gmail.com",
        agentId: "bot-2",
      }),
    ).toBe("owned");
  });

  it("does not treat another user's org-owned agent as owned", () => {
    vi.mocked(listOwnershipRecords).mockReturnValue([
      {
        subjectKind: "agent",
        subjectId: "bot-2",
        bindingStatus: "active",
        currentManagerUserId: "other-user",
      } as never,
    ]);
    expect(
      resolveTrustedUserOperationalIdentityAgentScope({
        currentUserId: "user-1",
        agentId: "bot-2",
      }),
    ).toBe("shared");
  });
});
