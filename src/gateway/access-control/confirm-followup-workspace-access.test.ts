import { expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ rows: [] as unknown[], confirm: vi.fn() }));
vi.mock("../../agent-runtime/state/repository/blocked-followup-delivery-recovery.js", () => ({
  collectBlockedFollowupDeliveryPersistRoots: () => ["/trusted"],
}));
vi.mock("../../agent-runtime/state/repository/blocked-followup-delivery.js", () => ({
  listBlockedFollowupDeliveries: () => s.rows,
}));
vi.mock("../../config/config.js", () => ({ loadConfig: () => ({}) }));
vi.mock("../tenant-context.js", () => ({
  requireTenantContext: async () => ({ tenantId: "t", userId: "admin" }),
}));
vi.mock("./followup-workspace-reauthorization.js", () => ({
  confirmAccessReauthorization: s.confirm,
}));
import {
  confirmFollowupWorkspaceAccess,
  listFollowupWorkspaceWaits,
} from "./confirm-followup-workspace-access.js";
const client = { sessionDomain: "enterprise", sessionKind: "enterprise-admin" } as Parameters<
  typeof confirmFollowupWorkspaceAccess
>[0];
it("rejects absent admin", async () => {
  await expect(confirmFollowupWorkspaceAccess(null, "r")).rejects.toThrow(
    "enterprise_admin_required",
  );
});
it("rejects foreign records", async () => {
  s.confirm.mockClear();
  s.rows = [
    {
      id: "r",
      status: "reauthorization_required",
      workspaceBinding: { tenantId: "other" },
      reauthorization: { kind: "owner" },
    },
  ];
  await expect(confirmFollowupWorkspaceAccess(client, "r")).rejects.toThrow("record_scope_denied");
  expect(s.confirm).not.toHaveBeenCalled();
});
it("constructs grant only from trusted actor and selected record", async () => {
  s.confirm.mockClear();
  s.rows = [
    {
      id: "r",
      status: "reauthorization_required",
      workspaceBinding: { tenantId: "t" },
      reauthorization: { kind: "permission" },
    },
  ];
  await confirmFollowupWorkspaceAccess(client, "r");
  expect(s.confirm).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "r",
      persistRoot: "/trusted",
      authorization: expect.objectContaining({
        kind: "permission",
        actorIdentity: "tenant:t:user:admin",
      }),
    }),
  );
});
it("rejects ambiguous records", async () => {
  s.rows = [{ id: "r" }, { id: "r" }];
  await expect(confirmFollowupWorkspaceAccess(client, "r")).rejects.toThrow("ambiguous");
});

it("lists only current tenant summaries without exposing recovery payloads", async () => {
  s.rows = [
    {
      id: "mine",
      workspaceBinding: { tenantId: "t" },
      status: "recoverable_wait",
      reason: "receipt_reconciliation_required",
      resume: { payloads: [{ text: "secret" }] },
    },
    { id: "foreign", workspaceBinding: { tenantId: "other" } },
  ];
  const rows = await listFollowupWorkspaceWaits(client);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: "mine", receiptReconciliationRequired: true });
  expect(JSON.stringify(rows)).not.toContain("secret");
});
