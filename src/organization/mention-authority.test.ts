import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canMention,
  loadMentionAuthorityPolicy,
  loadMentionAuthorityPolicyForOrganization,
  parseMentionAuthorityPolicy,
} from "./mention-authority.js";
import type { RuntimeIdentity, RuntimeOrganizationContext } from "./runtime.js";

function identity(overrides: Partial<RuntimeIdentity> = {}): RuntimeIdentity {
  return {
    agentId: overrides.agentId ?? "sender",
    displayName: overrides.displayName ?? "Sender",
    permissions: overrides.permissions ?? [],
    reachableAgents: overrides.reachableAgents ?? [],
    identitySource: overrides.identitySource ?? "fallback",
    capabilities: overrides.capabilities ?? [],
    ...overrides,
  };
}

function organizationContext(
  overrides: Partial<RuntimeOrganizationContext> = {},
): RuntimeOrganizationContext {
  const self = overrides.self ?? identity();
  return {
    self,
    coordinator: overrides.coordinator ?? {
      agentId: "coordinator",
      displayName: "Coordinator",
    },
    members: overrides.members ?? [
      self,
      {
        agentId: "agent-a",
        displayName: "Agent A",
      },
      {
        agentId: "coordinator",
        displayName: "Coordinator",
      },
    ],
  };
}

describe("MentionAuthority", () => {
  it("allows all members to mention everyone and the coordinator", () => {
    const senderIdentity = identity();
    const context = organizationContext({ self: senderIdentity });

    expect(
      canMention({
        senderIdentity,
        targetAgentId: "__all__",
        organizationContext: context,
      }),
    ).toEqual({ allowed: true });
    expect(
      canMention({
        senderIdentity,
        targetAgentId: "coordinator",
        organizationContext: context,
      }),
    ).toEqual({ allowed: true });
  });

  it("allows direct mentions only for organization members", () => {
    const senderIdentity = identity();
    const context = organizationContext({ self: senderIdentity });

    expect(
      canMention({
        senderIdentity,
        targetAgentId: "agent-a",
        organizationContext: context,
      }),
    ).toEqual({ allowed: true });
    expect(
      canMention({
        senderIdentity,
        targetAgentId: "missing-agent",
        organizationContext: context,
      }).allowed,
    ).toBe(false);
  });

  it("restricts @system to admin or coordinator permissions", () => {
    const context = organizationContext();
    expect(
      canMention({
        senderIdentity: identity({ permissions: [] }),
        targetAgentId: "__system__",
        organizationContext: context,
      }).allowed,
    ).toBe(false);
    expect(
      canMention({
        senderIdentity: identity({ permissions: ["coordinate"] }),
        targetAgentId: "__system__",
        organizationContext: context,
      }),
    ).toEqual({ allowed: true });
    expect(
      canMention({
        senderIdentity: identity({ permissions: ["admin"] }),
        targetAgentId: "__system__",
        organizationContext: context,
      }),
    ).toEqual({ allowed: true });
  });

  it("evaluates custom policy rules before defaults", () => {
    const senderIdentity = identity({ permissions: [] });
    const context = organizationContext({ self: senderIdentity });

    expect(
      canMention({
        senderIdentity,
        targetAgentId: "__all__",
        organizationContext: context,
        policy: {
          rules: [
            {
              effect: "deny",
              targetKind: "all",
              reason: "Broadcast mentions are disabled in this group.",
            },
          ],
        },
      }),
    ).toEqual({
      allowed: false,
      reason: "Broadcast mentions are disabled in this group.",
    });

    expect(
      canMention({
        senderIdentity,
        targetAgentId: "__system__",
        organizationContext: context,
        policy: {
          rules: [
            {
              effect: "allow",
              targetKind: "system",
              sourceAgentIds: ["sender"],
              reason: "Explicit support operator override.",
            },
          ],
        },
      }),
    ).toEqual({
      allowed: true,
      reason: "Explicit support operator override.",
    });
  });

  it("parses and loads mention-policy.json rules defensively", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-mention-policy-"));
    const filePath = path.join(root, "mention-policy.json");
    await fs.writeFile(
      filePath,
      JSON.stringify({
        rules: [
          { effect: "deny", targetKind: "all", reason: "No broadcast" },
          { effect: "maybe", targetKind: "all" },
        ],
      }),
    );

    expect(
      parseMentionAuthorityPolicy({ rules: [{ effect: "allow", targetKind: "member" }] }),
    ).toEqual({
      rules: [{ effect: "allow", targetKind: "member" }],
    });
    expect(await loadMentionAuthorityPolicy(filePath)).toEqual({
      rules: [{ effect: "deny", targetKind: "all", reason: "No broadcast" }],
    });
    expect(await loadMentionAuthorityPolicy(path.join(root, "missing.json"))).toEqual({
      rules: [],
    });
  });

  it("loads mention-policy.json from the organization memory directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-mention-policy-scope-"));
    const policyPath = path.join(root, "groups", "org-1", "memory", "mention-policy.json");
    await fs.mkdir(path.dirname(policyPath), { recursive: true });
    await fs.writeFile(
      policyPath,
      JSON.stringify({
        rules: [{ effect: "deny", targetKind: "system", reason: "Maintenance window" }],
      }),
    );

    await expect(
      loadMentionAuthorityPolicyForOrganization({
        cfg: { collaboration: { defaults: { workspace: root } } },
        workspaceDir: root,
        organizationId: "org-1",
      }),
    ).resolves.toEqual({
      rules: [{ effect: "deny", targetKind: "system", reason: "Maintenance window" }],
    });
  });
});
