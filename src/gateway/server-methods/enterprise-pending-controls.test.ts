import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorizeCommercialRun } from "../billing/authorize-commercial-run.js";
import {
  appendEnterpriseAuditEvent,
  readEnterpriseAuditExport,
} from "../enterprise-security/audit-log.js";
import { createMemoryIdempotencyStore } from "../enterprise-security/idempotency.js";
import {
  ENTERPRISE_ACCESS_PERMISSIONS_COMMIT_METHOD,
  ENTERPRISE_ACCESS_ROLES_CREATE_METHOD,
  ENTERPRISE_MESH_ASSET_BUDGET_SET_METHOD,
  ENTERPRISE_MESH_ASSET_PAUSE_METHOD,
  ENTERPRISE_SECURITY_AUDIT_EXPORT_METHOD,
  ENTERPRISE_SECURITY_IP_ALLOWLIST_SET_METHOD,
  ENTERPRISE_SECURITY_SESSION_POLICY_SET_METHOD,
} from "../enterprise-security/pending-controls.js";
import { applyStoredSessionControls } from "../enterprise-security/session-enforcement.js";
import {
  readTenantControls,
  setEnterpriseControlRootForTests,
  writeTenantControls,
  emptyTenantControls,
  assetControlKey,
} from "../enterprise-security/tenant-controls-store.js";
import { authorizeOperatorScopesForMethod } from "../method-scopes.js";
import type { PlatformAuthSessionRecord } from "../platform-auth/store-types.js";
import {
  enterprisePendingControlHandlers,
  setEnterprisePendingControlDepsForTests,
} from "./enterprise-pending-controls.js";
import type { GatewayClient } from "./types.js";

function client(over: Partial<GatewayClient> = {}): GatewayClient {
  return {
    connect: {
      minProtocol: 1,
      maxProtocol: 3,
      client: {
        id: "openbot-control-ui",
        displayName: "test",
        version: "0",
        platform: "web",
        mode: "webchat",
      },
      scopes: ["operator.admin", "operator.approvals"],
    },
    clientIp: "10.1.1.8",
    platformUserId: "user-1",
    sessionDomain: "enterprise",
    sessionKind: "enterprise-admin",
    sessionEnterpriseId: "tenant-a",
    ...over,
  };
}

function invoke(
  method: string,
  params: Record<string, unknown>,
  caller: GatewayClient | null = client(),
) {
  const handler = enterprisePendingControlHandlers[method];
  return new Promise<{
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: { message?: string };
  }>((resolve) => {
    void handler({
      req: { id: "1", method, type: "req" },
      params,
      client: caller,
      isWebchatConnect: () => false,
      respond: (ok, payload, error) => {
        resolve({ ok, payload: payload as Record<string, unknown> | undefined, error });
      },
      context: {} as never,
    });
  });
}

describe("enterprise pending controls", () => {
  let dir: string;

  afterEach(async () => {
    setEnterprisePendingControlDepsForTests(null);
    setEnterpriseControlRootForTests(null);
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function setup() {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-pending-"));
    setEnterpriseControlRootForTests(dir);
    setEnterprisePendingControlDepsForTests({
      idempotency: createMemoryIdempotencyStore(),
      lookupAsset: async ({ tenantId, assetId }) => {
        if (assetId === "missing") {
          return { status: "not_found" };
        }
        if (assetId === "foreign") {
          return { status: "tenant_mismatch" };
        }
        if (tenantId === "tenant-b" && assetId === "agent-a") {
          return { status: "not_found" };
        }
        return { status: "found" };
      },
      resolveMember: async (_tenantId, targetKey) => {
        if (targetKey === "missing-user") {
          return { status: "unknown" };
        }
        if (targetKey === "admin-user") {
          return { status: "found", userId: "admin-user", membershipRole: "enterprise-admin" };
        }
        return { status: "found", userId: targetKey, membershipRole: "member" };
      },
      exportAudit: async ({ tenantId, from, to, format }) => {
        const { createEnterpriseAuditExport } = await import("../enterprise-security/audit-log.js");
        return createEnterpriseAuditExport({ tenantId, from, to, format });
      },
    });
  }

  it("does not let operator.admin substitute for asset pause", () => {
    expect(
      authorizeOperatorScopesForMethod(ENTERPRISE_MESH_ASSET_PAUSE_METHOD, ["operator.admin"])
        .allowed,
    ).toBe(false);
    expect(
      authorizeOperatorScopesForMethod(ENTERPRISE_MESH_ASSET_PAUSE_METHOD, ["operator.approvals"])
        .allowed,
    ).toBe(true);
  });

  it("creates a role and grants usage:budget only for a non-admin member", async () => {
    await setup();
    const created = await invoke(ENTERPRISE_ACCESS_ROLES_CREATE_METHOD, {
      name: "budget-operator",
      permissionIds: ["usage:budget"],
      idempotencyKey: "role-1",
    });
    expect(created.ok).toBe(true);
    expect(created.payload).toMatchObject({ ok: true });
    const roleId = String(created.payload?.roleId);

    const unknown = await invoke(ENTERPRISE_ACCESS_PERMISSIONS_COMMIT_METHOD, {
      targetKind: "member",
      targetKey: "member-1",
      permissionIds: ["usage:budget", "member:delete"],
      confirmedHighRiskPermissionIds: ["usage:budget"],
      idempotencyKey: "commit-unknown",
    });
    expect(unknown.payload).toMatchObject({ ok: false, reason: "unknown_permission" });

    const unconfirmed = await invoke(ENTERPRISE_ACCESS_PERMISSIONS_COMMIT_METHOD, {
      targetKind: "member",
      targetKey: "member-1",
      permissionIds: ["usage:budget"],
      idempotencyKey: "commit-risk",
    });
    expect(unconfirmed.payload).toMatchObject({
      ok: false,
      reason: "high_risk_confirmation_required",
    });

    const admin = await invoke(ENTERPRISE_ACCESS_PERMISSIONS_COMMIT_METHOD, {
      targetKind: "member",
      targetKey: "admin-user",
      permissionIds: ["usage:budget"],
      confirmedHighRiskPermissionIds: ["usage:budget"],
      idempotencyKey: "commit-admin",
    });
    expect(admin.payload).toMatchObject({ ok: false, reason: "membership_role_fixed" });

    const builtin = await invoke(ENTERPRISE_ACCESS_PERMISSIONS_COMMIT_METHOD, {
      targetKind: "role",
      targetKey: "admin",
      permissionIds: [],
      idempotencyKey: "commit-builtin",
    });
    expect(builtin.payload).toMatchObject({ ok: false, reason: "builtin_role_fixed" });

    const committed = await invoke(ENTERPRISE_ACCESS_PERMISSIONS_COMMIT_METHOD, {
      targetKind: "member",
      targetKey: "member-1",
      permissionIds: ["usage:budget"],
      confirmedHighRiskPermissionIds: ["usage:budget"],
      idempotencyKey: "commit-ok",
    });
    expect(committed.payload).toMatchObject({ ok: true });
    const stored = await readTenantControls("tenant-a");
    expect(stored.roles[roleId]?.permissionIds).toEqual(["usage:budget"]);
    expect(stored.memberGrants["member-1"]?.permissionIds).toEqual(["usage:budget"]);
    expect(stored.memberGrants["admin-user"]).toBeUndefined();
  });

  it("rejects an allowlist that would lock out the caller and enforces idle drop", async () => {
    await setup();
    const locked = await invoke(ENTERPRISE_SECURITY_IP_ALLOWLIST_SET_METHOD, {
      cidrs: ["192.168.0.0/24"],
      idempotencyKey: "ip-lock",
    });
    expect(locked.payload).toMatchObject({ ok: false, reason: "would_lock_out_caller" });
    expect((await readTenantControls("tenant-a")).ipAllowlist).toBeUndefined();

    const saved = await invoke(ENTERPRISE_SECURITY_IP_ALLOWLIST_SET_METHOD, {
      cidrs: ["10.1.1.0/24"],
      idempotencyKey: "ip-ok",
    });
    expect(saved.payload).toMatchObject({ ok: true, cidrs: ["10.1.1.0/24"] });

    const policy = await invoke(ENTERPRISE_SECURITY_SESSION_POLICY_SET_METHOD, {
      idleTimeoutMinutes: 15,
      idempotencyKey: "idle-1",
    });
    expect(policy.payload).toMatchObject({ ok: true, idleTimeoutMinutes: 15 });

    const session = {
      id: "sess-1",
      userId: "user-1",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      sessionIssuedAt: "2026-10-01T00:00:00.000Z",
      lastActivityAt: "2026-10-01T00:00:00.000Z",
      expiresAt: "2026-12-01T00:00:00.000Z",
      enterpriseId: "tenant-a",
    } satisfies PlatformAuthSessionRecord;
    const idle = await applyStoredSessionControls({
      session,
      clientIp: "10.1.1.8",
      nowMs: Date.parse("2026-10-01T00:20:00.000Z"),
    });
    expect(idle).toEqual({ action: "drop", reason: "idle" });
    const ip = await applyStoredSessionControls({
      session,
      clientIp: "192.168.1.9",
      nowMs: Date.parse("2026-10-01T00:05:00.000Z"),
    });
    expect(ip).toEqual({ action: "deny", reason: "ip" });
  });

  it("exports only the caller tenant audit", async () => {
    await setup();
    await appendEnterpriseAuditEvent({
      ts: "2026-10-02T00:00:00.000Z",
      tenantId: "tenant-a",
      kind: "control_write",
      summary: "tenant-a-only",
    });
    await appendEnterpriseAuditEvent({
      ts: "2026-10-02T00:00:00.000Z",
      tenantId: "tenant-b",
      kind: "control_write",
      summary: "tenant-b-secret",
    });
    const exported = await invoke(ENTERPRISE_SECURITY_AUDIT_EXPORT_METHOD, {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-03T00:00:00.000Z",
      format: "json",
      idempotencyKey: "export-1",
    });
    expect(exported.payload).toMatchObject({ ok: true });
    const exportId = String(exported.payload?.exportId);
    const stored = await readEnterpriseAuditExport(exportId);
    expect(stored?.tenantId).toBe("tenant-a");
    expect(stored?.content).toContain("tenant-a-only");
    expect(stored?.content).not.toContain("tenant-b-secret");

    const wide = await invoke(ENTERPRISE_SECURITY_AUDIT_EXPORT_METHOD, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-10-03T00:00:00.000Z",
      format: "json",
      idempotencyKey: "export-wide",
    });
    expect(wide.payload).toMatchObject({ ok: false, reason: "range_too_wide" });
  });

  it("pauses an agent for the run gate and refuses group budget", async () => {
    await setup();
    const missing = await invoke(ENTERPRISE_MESH_ASSET_PAUSE_METHOD, {
      assetType: "agent",
      assetId: "missing",
      action: "pause",
      reason: "stop",
      idempotencyKey: "pause-missing",
    });
    expect(missing.payload).toMatchObject({ ok: false, reason: "asset_not_found" });

    const paused = await invoke(ENTERPRISE_MESH_ASSET_PAUSE_METHOD, {
      assetType: "agent",
      assetId: "agent-a",
      action: "pause",
      reason: "stop",
      idempotencyKey: "pause-1",
    });
    expect(paused.payload).toMatchObject({ ok: true, governanceStatus: "paused" });
    const again = await invoke(ENTERPRISE_MESH_ASSET_PAUSE_METHOD, {
      assetType: "agent",
      assetId: "agent-a",
      action: "pause",
      reason: "stop",
      idempotencyKey: "pause-2",
    });
    expect(again.payload).toMatchObject({ ok: false, reason: "already_in_state" });

    const groupBudget = await invoke(ENTERPRISE_MESH_ASSET_BUDGET_SET_METHOD, {
      assetType: "group",
      assetId: "group-a",
      monthlyLimitCents: 100,
      idempotencyKey: "budget-group",
    });
    expect(groupBudget.payload).toMatchObject({ ok: false, reason: "spend_not_metered" });
    expect((await readTenantControls("tenant-a")).assetBudgets).toEqual({});

    const agentBudget = await invoke(ENTERPRISE_MESH_ASSET_BUDGET_SET_METHOD, {
      assetType: "agent",
      assetId: "agent-a",
      monthlyLimitCents: 0,
      idempotencyKey: "budget-agent",
    });
    expect(agentBudget.payload).toMatchObject({
      ok: true,
      budget: { assetType: "agent", assetId: "agent-a", monthlyLimitCents: 0 },
    });

    const adminOnly = await invoke(
      ENTERPRISE_MESH_ASSET_PAUSE_METHOD,
      {
        assetType: "agent",
        assetId: "agent-a",
        action: "resume",
        reason: "resume",
        idempotencyKey: "pause-admin",
      },
      client({ connect: { ...client().connect, scopes: ["operator.admin"] } }),
    );
    expect(adminOnly.ok).toBe(false);
  });

  it("blocks a commercial run when the agent pause record exists", async () => {
    await setup();
    const document = emptyTenantControls();
    document.assetPauses[assetControlKey("agent", "agent-x")] = {
      assetType: "agent",
      assetId: "agent-x",
      paused: true,
      reason: "stop",
    };
    await writeTenantControls("ent-auth", document);
    const result = await authorizeCommercialRun({
      runId: "r-paused",
      enterpriseId: "ent-auth",
      agentId: "agent-x",
      action: "agent_run",
    });
    expect(result).toMatchObject({
      allowed: false,
      skipped: false,
      reason: "ASSET_PAUSED",
      enterpriseId: "ent-auth",
    });
  });
});
