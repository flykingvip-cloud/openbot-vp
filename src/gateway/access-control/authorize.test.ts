// @vitest-environment node
// Feature: shared-agent-identity-access-control-plane

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpRoot = path.join(os.tmpdir(), `openbot-access-audit-${Date.now()}`);

// Redirect the audit sink to a temp CONFIG_DIR so the real one is never touched.
vi.mock("../../utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils.js")>()),
  CONFIG_DIR: tmpRoot,
}));

const { setPrimaryOwner } = await import("../agent-registry/ownership.js");
const { createAgentAsset } = await import("../agent-registry/registry.js");
const { createEmptyAgentRegistryStore } = await import("../agent-registry/types.js");
const { accessControlAuditPaths } = await import("./audit-sink.js");
const {
  authorizeAgentAssetAccess,
  auditOwnershipTransfer,
  rejectAgentAssetWriteWhenDenied,
  resolveAccessControlMode,
  resolveTenantEnforcementMode,
} = await import("./authorize.js");
const { buildOwnerBaselinePolicies } = await import("./policy-v2-evaluator.js");

type Registry = ReturnType<typeof createEmptyAgentRegistryStore>;

const NOW = "2026-07-31T00:00:00.000Z";

const SUBJECT = {
  subjectType: "membership",
  subjectId: "membership-1",
  status: "active",
} as const;

function setup(): { registry: Registry; ref: { enterpriseId: string; agentAssetId: string } } {
  const registry = createEmptyAgentRegistryStore();
  const asset = createAgentAsset({
    store: registry,
    enterpriseId: "ent-a",
    agentSlug: "sales-bot",
    displayName: "Sales Bot",
    nowIso: NOW,
  });
  return { registry, ref: { enterpriseId: "ent-a", agentAssetId: asset.agentAssetId } };
}

async function readAudit(kind: "decisions" | "governance"): Promise<Record<string, unknown>[]> {
  const file = accessControlAuditPaths()[kind];
  const raw = await fs.readFile(file, "utf8").catch(() => "");
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("access control mode", () => {
  it("defaults to shadow so an empty Registry cannot deny live traffic", () => {
    expect(resolveAccessControlMode({})).toBe("shadow");
    expect(resolveAccessControlMode({ OPENBOT_ACCESS_CONTROL_MODE: "  ENFORCE " })).toBe("enforce");
    expect(resolveAccessControlMode({ OPENCLAW_ACCESS_CONTROL_MODE: "enforce" })).toBe("enforce");
    expect(resolveAccessControlMode({ OPENBOT_ACCESS_CONTROL_MODE: "anything-else" })).toBe(
      "shadow",
    );
  });
});

describe("per-tenant enforcement gate", () => {
  it("stays shadow when nobody asked for enforcement, without reading v1", async () => {
    let reads = 0;
    expect(
      await resolveTenantEnforcementMode({
        enterpriseId: "ent-a",
        env: {},
        countActiveV1Policies: () => {
          reads += 1;
          return 0;
        },
      }),
    ).toEqual({ mode: "shadow", reason: "mode-not-enforce" });
    expect(reads).toBe(0);
  });

  it("refuses to enforce while v1 rows are still authoritative", async () => {
    // Regression: assertSingleAuthoritativePolicySet had no runtime caller, so enforce
    // would have applied V2 while v1 was still the live fallback.
    expect(
      await resolveTenantEnforcementMode({
        enterpriseId: "ent-a",
        env: { OPENBOT_ACCESS_CONTROL_MODE: "enforce" },
        countActiveV1Policies: () => 58,
      }),
    ).toEqual({ mode: "shadow", reason: "v1-still-authoritative", activeV1Count: 58 });
  });

  it("enforces once v1 is drained", async () => {
    expect(
      await resolveTenantEnforcementMode({
        enterpriseId: "ent-a",
        env: { OPENBOT_ACCESS_CONTROL_MODE: "enforce" },
        countActiveV1Policies: () => 0,
      }),
    ).toEqual({ mode: "enforce", activeV1Count: 0 });
  });
});

describe("authorizeAgentAssetAccess", () => {
  it("allows in shadow mode but records the would-be denial", async () => {
    const { registry, ref } = setup();
    const result = await authorizeAgentAssetAccess({
      policies: [],
      registry,
      subject: SUBJECT,
      resource: ref,
      permission: "agent.read",
      mode: "shadow",
      requestId: "req-1",
    });
    expect(result).toMatchObject({ allowed: true, mode: "shadow" });
    expect(result.decision.allowed).toBe(false);

    const [event] = await readAudit("decisions");
    expect(event).toMatchObject({
      requestId: "req-1",
      mode: "shadow",
      enterpriseId: "ent-a",
      subjectType: "membership",
      subjectId: "membership-1",
      resourceType: "agent_asset",
      resourceId: ref.agentAssetId,
      permission: "agent.read",
      evaluated: "deny",
      reason: "no-matching-policy",
      effect: "allowed",
    });
  });

  it("records the real resource for a non-agent resource type", async () => {
    // Regression: the audit line used to hardcode `agent_asset` and only carry
    // `agentAssetId`, so a seat/space/memory decision lost the resource it decided.
    const { registry } = setup();
    await authorizeAgentAssetAccess({
      policies: [],
      registry,
      subject: SUBJECT,
      resource: { enterpriseId: "ent-a", resourceType: "space", resourceId: "space-7" },
      permission: "space.read",
      mode: "shadow",
      requestId: "req-space",
    });
    const [event] = await readAudit("decisions");
    expect(event).toMatchObject({
      requestId: "req-space",
      resourceType: "space",
      resourceId: "space-7",
      permission: "space.read",
    });
  });

  it("does not write an identity file when default shadow denies the asset", async () => {
    const prev = process.env.OPENBOT_ACCESS_CONTROL_MODE;
    const prevLegacy = process.env.OPENCLAW_ACCESS_CONTROL_MODE;
    delete process.env.OPENBOT_ACCESS_CONTROL_MODE;
    delete process.env.OPENCLAW_ACCESS_CONTROL_MODE;
    try {
      const { registry, ref } = setup();
      const result = await authorizeAgentAssetAccess({
        policies: [],
        registry,
        subject: SUBJECT,
        resource: ref,
        permission: "agent.manage",
      });
      expect(result.mode).toBe("shadow");
      expect(result.allowed).toBe(true);
      expect(result.decision.allowed).toBe(false);
      const identityPath = path.join(tmpRoot, "IDENTITY.md");
      await expect(async () => {
        rejectAgentAssetWriteWhenDenied(result);
        await fs.appendFile(identityPath, "- Name: denied\n", "utf8");
      }).rejects.toThrow(/agent asset access denied: no-matching-policy/);
      await expect(fs.access(identityPath)).rejects.toThrow();
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_ACCESS_CONTROL_MODE;
      } else {
        process.env.OPENBOT_ACCESS_CONTROL_MODE = prev;
      }
      if (prevLegacy === undefined) {
        delete process.env.OPENCLAW_ACCESS_CONTROL_MODE;
      } else {
        process.env.OPENCLAW_ACCESS_CONTROL_MODE = prevLegacy;
      }
    }
  });

  it("denies in enforce mode and records the enforced effect", async () => {
    const { registry, ref } = setup();
    const result = await authorizeAgentAssetAccess({
      policies: [],
      registry,
      subject: SUBJECT,
      resource: ref,
      permission: "agent.read",
      mode: "enforce",
    });
    expect(result.allowed).toBe(false);

    const [event] = await readAudit("decisions");
    expect(event).toMatchObject({ mode: "enforce", evaluated: "deny", effect: "denied" });
  });

  it("records an allow with the matched policy id", async () => {
    const { registry, ref } = setup();
    setPrimaryOwner({
      store: registry,
      ref,
      ownerType: "membership",
      ownerId: "membership-1",
      nowIso: NOW,
    });
    const policies = buildOwnerBaselinePolicies({
      registry,
      resource: ref,
      nowIso: NOW,
      makePolicyId: (permission) => `owner-${permission}`,
    });
    const result = await authorizeAgentAssetAccess({
      policies,
      registry,
      subject: SUBJECT,
      resource: ref,
      permission: "agent.manage",
      mode: "enforce",
    });
    expect(result.allowed).toBe(true);

    const [event] = await readAudit("decisions");
    expect(event).toMatchObject({
      evaluated: "allow",
      effect: "allowed",
      matchedPolicyId: "owner-agent.manage",
      permission: "agent.manage",
    });
    expect(event.reason).toBeUndefined();
  });

  it("carries the delegated membership on a service principal decision", async () => {
    const { registry, ref } = setup();
    await authorizeAgentAssetAccess({
      policies: [],
      registry,
      subject: {
        subjectType: "service_principal",
        subjectId: "sp-1",
        status: "active",
        onBehalfOfMembershipId: "membership-1",
      },
      resource: ref,
      permission: "growth.read",
      mode: "shadow",
    });
    const [event] = await readAudit("decisions");
    expect(event).toMatchObject({
      subjectType: "service_principal",
      subjectId: "sp-1",
      onBehalfOfMembershipId: "membership-1",
    });
  });

  it("keeps decisions and governance in separate streams", async () => {
    const { registry, ref } = setup();
    await authorizeAgentAssetAccess({
      policies: [],
      registry,
      subject: SUBJECT,
      resource: ref,
      permission: "agent.read",
      mode: "shadow",
    });
    await auditOwnershipTransfer({
      resource: ref,
      actor: { subjectType: "membership", subjectId: "membership-9" },
      ownerType: "seat",
      ownerId: "seat-1",
      previousOwnerId: "membership-1",
      requestId: "req-2",
    });

    expect(await readAudit("decisions")).toHaveLength(1);
    const [governance] = await readAudit("governance");
    expect(governance).toMatchObject({
      requestId: "req-2",
      enterpriseId: "ent-a",
      action: "ownership.transfer",
      actor: { subjectType: "membership", subjectId: "membership-9" },
      target: { agentAssetId: ref.agentAssetId, ownerType: "seat", ownerId: "seat-1" },
      detail: { previousOwnerId: "membership-1" },
    });
  });

  it("never lets an audit write failure change the outcome", async () => {
    const { registry, ref } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const appendFile = vi
      .spyOn(fs, "appendFile")
      .mockRejectedValue(new Error("disk full") as never);
    try {
      const result = await authorizeAgentAssetAccess({
        policies: [],
        registry,
        subject: SUBJECT,
        resource: ref,
        permission: "agent.read",
        mode: "enforce",
      });
      // The evaluator still decided; only the audit line was lost.
      expect(result.allowed).toBe(false);
      expect(warn).toHaveBeenCalled();
    } finally {
      appendFile.mockRestore();
      warn.mockRestore();
    }
  });
});

describe("governance access-control shadow hook (PR-P2-3)", () => {
  it("keeps access results unchanged under default env (governance shadow flag off)", async () => {
    const { registry, ref } = setup();
    setPrimaryOwner({
      store: registry,
      ref,
      ownerType: "membership",
      ownerId: SUBJECT.subjectId,
      nowIso: NOW,
    });
    const policies = buildOwnerBaselinePolicies({
      registry,
      resource: ref,
      nowIso: NOW,
      makePolicyId: (permission) => `owner:${ref.agentAssetId}:${permission}`,
    });
    // Default process env must not enable the governance shadow flag.
    expect(process.env.OPENBOT_GOVERNANCE_ACCESS_CONTROL_SHADOW).toBeFalsy();
    const result = await authorizeAgentAssetAccess({
      policies,
      registry,
      subject: SUBJECT,
      resource: ref,
      permission: "agent.execute",
      mode: "shadow",
    });
    // Access-control shadow mode: caller always allowed; evaluator may allow via owner baseline.
    expect(result.allowed).toBe(true);
    expect(result.mode).toBe("shadow");
    expect(result.decision.allowed).toBe(true);
  });

  it("resolveAccessControlMode default remains shadow (unchanged by P2-3)", () => {
    expect(resolveAccessControlMode({})).toBe("shadow");
  });
});
