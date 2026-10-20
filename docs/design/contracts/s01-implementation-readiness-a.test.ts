/**
 * S01 Implementation Readiness A — non-production contract gates.
 * Does not wire get-reply, write Catalog, or flip implementationVerified.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceOwnerScope } from "../../../src/gateway/workspace-ownership/types.js";
import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
} from "../../../src/gateway/workspace-resolver/catalog.js";
import type {
  WorkspaceBindingRecord,
  WorkspaceResourceRecord,
} from "../../../src/gateway/workspace-resolver/types.js";
import {
  createInMemoryS01MembershipPort,
  createInMemoryS01StewardIdentityPort,
  evaluateS01AuthorizedToolCwd,
  inspectWorkspaceHandleProjection,
  issueTrustedPrincipal,
  parseS01Locator,
  projectWorkspaceHandleView,
  S01_ATTESTATION_TEST_SECRET,
  S01_IMPLEMENTATION_VERIFIED,
  S01_INDEPENDENT_CATALOG_TABLES,
  S01_PRODUCTION_WIRED,
  S01_SESSION_HMAC_TEST_SECRET,
  s01AuthorizedToolCwdErrorCodeSchema,
  signS01SessionHmac,
  type S01PresentedSourceProof,
  type S01TrustMaterial,
  type TrustedPrincipal,
} from "./s01-trusted-principal-handle-contract.js";

const NOW = 1_725_000_000_000;
const repoRoot = join(import.meta.dir, "../../..");

const verifiedSession = {
  userId: "usr-123",
  tenantId: "ent-456",
  sessionDomain: "employee" as const,
  source: "platform-auth-session" as const,
  sessionId: "sess-abc",
};

const sessionTrust: S01TrustMaterial = {
  attestationSecret: S01_ATTESTATION_TEST_SECRET,
  source: {
    source: "platform-auth-session",
    sessionHmacSecret: S01_SESSION_HMAC_TEST_SECRET,
  },
};

const presentedSessionProof: S01PresentedSourceProof = {
  source: "platform-auth-session",
  sessionId: "sess-abc",
  hmac: signS01SessionHmac(S01_SESSION_HMAC_TEST_SECRET, "sess-abc"),
};

const principal = issueTrustedPrincipal({
  verifiedSession,
  presentedProof: presentedSessionProof,
  trust: sessionTrust,
  resolvedAt: NOW,
}) as TrustedPrincipal;

const memberships = createInMemoryS01MembershipPort({
  memberships: [{ userId: "usr-123", tenantId: "ent-456" }],
});

function workspaceEntry(params: {
  resourceId: string;
  tenantId: string;
  userId?: string;
  locator: string;
  lifecycleState?: WorkspaceResourceRecord["lifecycleState"];
  role?: WorkspaceBindingRecord["role"];
  bindingState?: WorkspaceBindingRecord["state"];
  bindingId?: string;
  contentVersion?: string;
  ownerScope?: WorkspaceOwnerScope;
}): { resource: WorkspaceResourceRecord; binding: WorkspaceBindingRecord } {
  const userId = params.userId ?? "usr-123";
  const ownerScope: WorkspaceOwnerScope = params.ownerScope ?? {
    kind: "user_owned",
    userId,
    agentAssetId: "asset-alpha",
    proof: {
      source: "explicit_binding",
      ownerType: "user",
      ownerId: userId,
      agentAssetId: "asset-alpha",
    },
  };
  return {
    resource: {
      resourceId: params.resourceId,
      resourceType: "workspace",
      tenantId: params.tenantId,
      ownerScope,
      lifecycleState: params.lifecycleState ?? "active",
      classification: "internal",
      governanceVersion: 1,
    },
    binding: {
      bindingId: params.bindingId ?? `${params.resourceId}:canonical`,
      resourceId: params.resourceId,
      role: params.role ?? "canonical",
      locator: params.locator,
      state: params.bindingState ?? "active",
      contentVersion: params.contentVersion ?? "v1",
    },
  };
}

function catalogWith(
  entries: Array<{ resource: WorkspaceResourceRecord; binding: WorkspaceBindingRecord }>,
  extraBindings: WorkspaceBindingRecord[] = [],
): InMemoryWorkspaceResourceCatalog {
  const resources: Record<string, WorkspaceResourceRecord> = {};
  const bindings: Record<string, WorkspaceBindingRecord> = {};
  for (const entry of entries) {
    resources[entry.resource.resourceId] = entry.resource;
    bindings[entry.binding.bindingId] = entry.binding;
  }
  for (const binding of extraBindings) {
    bindings[binding.bindingId] = binding;
  }
  return new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog().snapshot(),
    resources,
    bindings,
  });
}

const siblingCatalog = catalogWith([
  workspaceEntry({
    resourceId: "wsr_alpha",
    tenantId: "ent-456",
    locator: "/workspace/group-alpha",
  }),
  workspaceEntry({
    resourceId: "wsr_beta",
    tenantId: "ent-456",
    locator: "/workspace/group-beta",
  }),
]);

const identity = createInMemoryS01StewardIdentityPort([
  {
    tenantId: "ent-456",
    userId: "usr-123",
    agentId: "main",
    resourceId: "wsr_alpha",
  },
]);

describe("S01 readiness A T1 stable resourceId", () => {
  it("T1 authorizes only the Registry target Handle", async () => {
    const result = await evaluateS01AuthorizedToolCwd({
      catalog: siblingCatalog,
      principal,
      requestedCwd: "/workspace/group-alpha",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_alpha",
      identity,
    });
    expect(result).toMatchObject({ ok: true, resolvedPath: "/workspace/group-alpha" });
    if (result.ok) {
      expect(result.handle.id).toBe("wsr_alpha");
    }
  });

  it("T1b does not authorize a same-tenant sibling locator", async () => {
    const result = await evaluateS01AuthorizedToolCwd({
      catalog: siblingCatalog,
      principal,
      requestedCwd: "/workspace/group-beta",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_alpha",
      identity,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "ERR_PATH_OUTSIDE_WORKSPACE",
      failClosed: true,
    });
  });

  it("T1c rejects a missing or wrong targetResourceId", async () => {
    const missing = await evaluateS01AuthorizedToolCwd({
      catalog: siblingCatalog,
      principal,
      requestedCwd: "/workspace/group-alpha",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "",
    });
    expect(missing).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });

    const wrong = await evaluateS01AuthorizedToolCwd({
      catalog: siblingCatalog,
      principal,
      requestedCwd: "/workspace/group-beta",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_beta",
      identity,
    });
    expect(wrong).toMatchObject({ ok: false, code: "ERR_WORKSPACE_OWNER_DENIED" });
  });

  it("T1d rejects Registry miss or multi-value identity", async () => {
    const miss = await evaluateS01AuthorizedToolCwd({
      catalog: siblingCatalog,
      principal,
      requestedCwd: "/workspace/group-alpha",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_alpha",
      identity: createInMemoryS01StewardIdentityPort([]),
    });
    expect(miss).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });

    const multi = await evaluateS01AuthorizedToolCwd({
      catalog: siblingCatalog,
      principal,
      requestedCwd: "/workspace/group-alpha",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_alpha",
      identity: createInMemoryS01StewardIdentityPort([
        {
          tenantId: "ent-456",
          userId: "usr-123",
          agentId: "main",
          resourceId: "wsr_alpha",
        },
        {
          tenantId: "ent-456",
          userId: "usr-123",
          agentId: "main",
          resourceId: "wsr_alpha",
        },
      ]),
    });
    expect(multi).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });
  });
});

describe("S01 readiness A handle fail-closed", () => {
  it("fails closed on missing resource and duplicate canonical", () => {
    expect(inspectWorkspaceHandleProjection(createEmptyWorkspaceCatalog(), "wsr_missing")).toEqual({
      ok: false,
      code: "ERR_WORKSPACE_NOT_FOUND",
    });
    const duplicate = catalogWith(
      [
        workspaceEntry({
          resourceId: "wsr_dup",
          tenantId: "ent-456",
          locator: "/workspace/dup",
        }),
      ],
      [
        {
          bindingId: "wsr_dup:canonical-2",
          resourceId: "wsr_dup",
          role: "canonical",
          locator: "/workspace/dup-other",
          state: "active",
          contentVersion: "v2",
        },
      ],
    );
    expect(inspectWorkspaceHandleProjection(duplicate, "wsr_dup")).toEqual({
      ok: false,
      code: "ERR_WORKSPACE_NOT_FOUND",
    });
    expect(projectWorkspaceHandleView(duplicate, "wsr_dup")).toBeNull();
  });

  it("does not project compatibility-only bindings", () => {
    const compat = catalogWith([
      workspaceEntry({
        resourceId: "wsr_compat",
        tenantId: "ent-456",
        locator: "/workspace/compat",
        role: "compatibility",
      }),
    ]);
    expect(inspectWorkspaceHandleProjection(compat, "wsr_compat")).toEqual({
      ok: false,
      code: "ERR_BINDING_NOT_CANONICAL",
    });
  });
});

describe("S01 readiness A path hardening", () => {
  it("rejects encoded traversal, absolute escape, and sibling-prefix", () => {
    expect(parseS01Locator("/workspace/group-alpha/%2e%2e/etc")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(parseS01Locator("/workspace/group-alpha/../etc")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(parseS01Locator("/workspace/group-alpha")).toEqual({
      ok: true,
      path: "/workspace/group-alpha",
    });
  });

  it("returns caller-must-lstat on success and denies unverified symlink follow", async () => {
    const allowed = await evaluateS01AuthorizedToolCwd({
      catalog: siblingCatalog,
      principal,
      requestedCwd: "notes",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_alpha",
      identity,
    });
    expect(allowed).toMatchObject({
      ok: true,
      resolvedPath: "/workspace/group-alpha/notes",
      symlinkSafety: "lexical-only-caller-must-lstat",
    });

    const symlink = await evaluateS01AuthorizedToolCwd({
      catalog: siblingCatalog,
      principal,
      requestedCwd: "/workspace/group-alpha",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_alpha",
      identity,
      symlinkFollowed: true,
    });
    expect(symlink).toMatchObject({
      ok: false,
      code: "ERR_INVALID_PATH",
      symlinkSafety: "denied-unverified",
      failClosed: true,
    });
  });
});

describe("S01 readiness A unique error matrix", () => {
  it("keeps the unique-handoff 11 codes and does not mint parallel codes", () => {
    expect(s01AuthorizedToolCwdErrorCodeSchema.options).toEqual([
      "ERR_PRINCIPAL_REQUIRED",
      "ERR_TENANT_BINDING_REQUIRED",
      "ERR_WORKSPACE_NOT_FOUND",
      "ERR_TENANT_MISMATCH",
      "ERR_CAPABILITY_DENIED",
      "ERR_WORKSPACE_ARCHIVED",
      "ERR_BINDING_NOT_CANONICAL",
      "ERR_PATH_OUTSIDE_WORKSPACE",
      "ERR_CATALOG_UNAVAILABLE",
      "ERR_INVALID_PATH",
      "ERR_WORKSPACE_OWNER_DENIED",
    ]);
    expect(s01AuthorizedToolCwdErrorCodeSchema.options).not.toContain("ERR_STALE_FENCING");
    expect(s01AuthorizedToolCwdErrorCodeSchema.options).not.toContain("ERR_OWNERSHIP_MISMATCH");
    expect(s01AuthorizedToolCwdErrorCodeSchema.options).not.toContain("ERR_WORKSPACE_SUSPENDED");
    expect(s01AuthorizedToolCwdErrorCodeSchema.options).not.toContain("ERR_WORKSPACE_RETIRED");
    expect(s01AuthorizedToolCwdErrorCodeSchema.options).not.toContain("ERR_BINDING_AMBIGUOUS");
  });
});

describe("S01 readiness A production freeze", () => {
  it("does not claim production verification or wiring", () => {
    expect(S01_IMPLEMENTATION_VERIFIED).toBe(false);
    expect(S01_PRODUCTION_WIRED).toBe(false);
    expect(S01_INDEPENDENT_CATALOG_TABLES).toEqual([
      "workspace_handles",
      "authorized_cwds",
      "tenant_memberships",
    ]);
  });

  it("T9 keeps get-reply helper and does not import the S01 contract into production paths", () => {
    const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
    const getReplyLines = getReply.split("\n");
    expect(getReplyLines[163]).toContain("resolveEmployeeBuiltinStewardWorkspaceDir");
    expect(getReply).not.toContain("evaluateS01AuthorizedToolCwd");
    expect(getReply).not.toContain("s01-trusted-principal-handle-contract");
    expect(getReply).not.toContain("s01-authorized-tool-cwd");

    const hits: string[] = [];
    const stack = [
      join(repoRoot, "src/auto-reply"),
      join(repoRoot, "src/memory"),
      join(repoRoot, "src/gateway"),
    ];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (!dir) {
        continue;
      }
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "dist") {
          continue;
        }
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!/\.(ts|js|mjs)$/u.test(name) || name.endsWith(".d.ts")) {
          continue;
        }
        const text = readFileSync(full, "utf-8");
        if (
          text.includes("s01-trusted-principal-handle-contract") ||
          text.includes("evaluateS01AuthorizedToolCwd")
        ) {
          hits.push(full.slice(repoRoot.length + 1));
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("does not change Item 7 remaining / liveWriteWatchIndex baseline", () => {
    const scan = JSON.parse(
      readFileSync(
        join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
        "utf-8",
      ),
    ) as {
      remaining: number;
      liveWriteWatchIndex: number;
      item7: string;
    };
    expect(scan.remaining).toBe(10);
    expect(scan.liveWriteWatchIndex).toBe(10);
    expect(scan.remaining).toBe(scan.liveWriteWatchIndex);
    expect(scan.item7).toBe("not-met");
  });

  it("keeps unique handoff implementationVerified false", () => {
    const handoff = readFileSync(
      join(
        repoRoot,
        ".kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md",
      ),
      "utf-8",
    );
    expect(handoff).toMatch(/implementationVerified:\s*false/);
    expect(handoff).not.toMatch(/implementationVerified:\s*true/);
  });

  it("does not create production Phase A adapters or forbidden tables", () => {
    expect(() =>
      statSync(join(repoRoot, "src/gateway/data-governance/s01-authorized-tool-cwd.ts")),
    ).toThrow();
    expect(() =>
      statSync(join(repoRoot, "src/gateway/data-governance/s01-steward-workspace-identity.ts")),
    ).toThrow();
    expect(() => statSync(join(repoRoot, "src/gateway/workspace-catalog"))).toThrow();
  });
});
