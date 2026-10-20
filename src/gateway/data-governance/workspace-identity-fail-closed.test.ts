import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertFailClosedWorkspaceIdentity } from "./workspace-identity-fail-closed.js";

void describe("assertFailClosedWorkspaceIdentity", () => {
  void it("rejects empty Catalog synthesis, agentId impersonation, and path identity", () => {
    assert.deepEqual(
      assertFailClosedWorkspaceIdentity({ catalogRecordCount: 0, agentAssetId: "asset-1" }),
      { ok: false, reason: "empty_catalog_synthesis_forbidden" },
    );
    assert.deepEqual(
      assertFailClosedWorkspaceIdentity({
        catalogRecordCount: 1,
        agentId: "bot-2",
        agentAssetId: "bot-2",
      }),
      { ok: false, reason: "agentId_is_not_agentAssetId" },
    );
    assert.deepEqual(
      assertFailClosedWorkspaceIdentity({
        catalogRecordCount: 1,
        agentAssetId: "asset-1",
        path: "/tmp/ws",
      }),
      { ok: false, reason: "identity_from_path_or_name_forbidden" },
    );
    assert.deepEqual(
      assertFailClosedWorkspaceIdentity({
        catalogRecordCount: 1,
        agentAssetId: "asset-1",
        realpath: "/tmp/ws",
      }),
      { ok: false, reason: "identity_from_path_or_name_forbidden" },
    );
    assert.deepEqual(
      assertFailClosedWorkspaceIdentity({
        catalogRecordCount: 1,
        agentAssetId: "asset-1",
        displayName: "panda",
      }),
      { ok: false, reason: "identity_from_path_or_name_forbidden" },
    );
  });

  void it("accepts an exact agentAssetId from a non-empty Catalog without path signals", () => {
    assert.deepEqual(
      assertFailClosedWorkspaceIdentity({
        catalogRecordCount: 1,
        agentId: "bot-2",
        agentAssetId: "asset-1",
      }),
      { ok: true, agentAssetId: "asset-1" },
    );
  });
});
