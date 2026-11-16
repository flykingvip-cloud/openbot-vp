import { expect, it, vi } from "vitest";
const p = vi.hoisted(() => ({
  migration: vi.fn(async () => ({ ok: true })),
  reauthorize: vi.fn(async () => ({ ok: true })),
  list: vi.fn(async () => []),
}));
vi.mock("../access-control/canonical-workspace-migration-control.js", () => ({
  controlCanonicalWorkspaceMigration: p.migration,
}));
vi.mock("../access-control/confirm-followup-workspace-access.js", () => ({
  confirmFollowupWorkspaceAccess: p.reauthorize,
  listFollowupWorkspaceWaits: p.list,
}));
import { meshGovernanceHandlers } from "./mesh-governance.js";
async function invoke(params: Record<string, unknown>) {
  const client = { sessionDomain: "enterprise", sessionKind: "enterprise-admin" };
  const respond = vi.fn();
  await meshGovernanceHandlers["mesh.governance.executeAction"]({
    params,
    client,
    respond,
  } as unknown as Parameters<(typeof meshGovernanceHandlers)[string]>[0]);
  return { client, respond };
}
it("routes real prepare and confirm branches without trusting a client directory", async () => {
  const { client } = await invoke({
    actionType: "prepare_canonical_workspace_migration",
    targetId: "r",
    destination: "/evil",
  });
  expect(p.migration).toHaveBeenLastCalledWith(client, {
    action: "prepare",
    resourceId: "r",
    planId: undefined,
  });
  await invoke({ actionType: "confirm_canonical_workspace_migration", planId: "p", confirm: true });
  expect(p.migration).toHaveBeenLastCalledWith(client, {
    action: "confirm",
    planId: "p",
    resourceId: undefined,
  });
});
it("refuses final migration without explicit confirmation", async () => {
  p.migration.mockClear();
  const { respond } = await invoke({
    actionType: "confirm_canonical_workspace_migration",
    planId: "p",
  });
  expect(respond.mock.calls[0][0]).toBe(false);
  expect(p.migration).not.toHaveBeenCalled();
});
it("routes explicit selected-record reauthorization and read-only status listing", async () => {
  const { client } = await invoke({
    actionType: "reauthorize_followup_delivery",
    targetId: "record",
    confirm: true,
    operatorUserId: "forged",
  });
  expect(p.reauthorize).toHaveBeenLastCalledWith(client, "record");
  await invoke({ actionType: "list_followup_workspace_waits" });
  expect(p.list).toHaveBeenCalledWith(client);
});
