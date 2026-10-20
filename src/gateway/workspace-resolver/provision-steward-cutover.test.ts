import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryWorkspaceCutoverStore } from "../workspace-cutover/index.js";
import type { OwnershipProof } from "../workspace-ownership/types.js";
import {
  provisionEmployeeStewardCutoverWorkspace,
  type StewardCutoverProvisionRequest,
} from "./provision-steward-cutover.js";

const TENANT = "tenant-a";
const USER = "user-1";
const ASSET = "steward:builtin";

const tmpDirs: string[] = [];

function tmpStateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provision-steward-cutover-"));
  tmpDirs.push(dir);
  return dir;
}

function validProof(): OwnershipProof {
  return { source: "explicit_binding", ownerType: "user", ownerId: USER, agentAssetId: ASSET };
}

function validRequest(
  overrides: Partial<StewardCutoverProvisionRequest> = {},
): StewardCutoverProvisionRequest {
  const stateDir = tmpStateDir();
  return {
    tenantContext: { tenantId: TENANT, userId: USER, domain: "enterprise" },
    actor: { userId: USER },
    ownershipProof: validProof(),
    placementRoot: stateDir,
    sourceRoot: path.join(stateDir, "source"),
    targetRoot: path.join(stateDir, "target"),
    cutoverStore: new InMemoryWorkspaceCutoverStore(),
    ...overrides,
  };
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("provisionEmployeeStewardCutoverWorkspace", () => {
  it("provisions unique source canonical/active + target compatibility/read_only bindings (dry, no fs)", () => {
    const store = new InMemoryWorkspaceCutoverStore();
    const result = provisionEmployeeStewardCutoverWorkspace(validRequest({ cutoverStore: store }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // Catalog holds exactly two bindings for the resource with the mandated roles/states.
    const bindings = result.catalog.listBindingsForResource(result.resourceId);
    expect(bindings).toHaveLength(2);
    const source = bindings.find((b) => b.bindingId === result.sourceBindingId);
    const target = bindings.find((b) => b.bindingId === result.targetBindingId);
    expect(source?.role).toBe("canonical");
    expect(source?.state).toBe("active");
    expect(target?.role).toBe("compatibility");
    expect(target?.state).toBe("read_only");

    // Exactly one writable canonical binding.
    const writableCanonical = bindings.filter(
      (b) => b.role === "canonical" && b.state === "active",
    );
    expect(writableCanonical).toHaveLength(1);
    expect(writableCanonical[0]?.bindingId).toBe(result.sourceBindingId);

    // Fencing marker recorded.
    const saved = store.get(result.operation.operationId);
    expect(saved?.resourceId).toBe(result.resourceId);
    expect(saved?.sourceBindingId).toBe(result.sourceBindingId);
    expect(saved?.targetBindingId).toBe(result.targetBindingId);
    expect(saved?.state).toBe("inventoried");

    // Receipt.
    expect(result.receipt.materialized).toBe(false);
    expect(result.receipt.copyDigest).toBeNull();
    expect(result.receipt.catalogStatus).toBe("available");

    // Catalog-before-fs: no directory was created in the dry provision.
    expect(fs.existsSync(result.sourceRoot)).toBe(false);
    expect(fs.existsSync(result.targetRoot)).toBe(false);
  });

  it("uses the caller-provided placement verbatim (no host-path derivation)", () => {
    const stateDir = tmpStateDir();
    const sourceRoot = path.join(stateDir, "src-root");
    const targetRoot = path.join(stateDir, "tgt-root");
    const result = provisionEmployeeStewardCutoverWorkspace(
      validRequest({ placementRoot: stateDir, sourceRoot, targetRoot }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.sourceRoot).toBe(sourceRoot);
    expect(result.targetRoot).toBe(targetRoot);
    expect(result.sourceRoot).not.toBe(process.cwd());
  });

  it("materializes the workspace only after Catalog success and records the copy digest", () => {
    const store = new InMemoryWorkspaceCutoverStore();
    const result = provisionEmployeeStewardCutoverWorkspace(
      validRequest({ cutoverStore: store, materialize: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(fs.existsSync(result.sourceRoot)).toBe(true);
    expect(fs.existsSync(result.targetRoot)).toBe(true);
    expect(result.receipt.materialized).toBe(true);
    expect(typeof result.receipt.copyDigest).toBe("string");
    // Operation advanced past inventoried once fs work completed.
    expect(store.get(result.operation.operationId)?.state).toBe("prepared");
  });

  it("produces a stable resourceId and operationId for the same trusted subject", () => {
    const a = provisionEmployeeStewardCutoverWorkspace(validRequest());
    const b = provisionEmployeeStewardCutoverWorkspace(validRequest());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) {
      return;
    }
    expect(a.resourceId).toBe(b.resourceId);
    expect(a.operation.operationId).toBe(b.operation.operationId);
  });

  it("fails closed when tenant context is missing", () => {
    const store = new InMemoryWorkspaceCutoverStore();
    const result = provisionEmployeeStewardCutoverWorkspace(
      validRequest({ tenantContext: null, cutoverStore: store }),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "missing_tenant_context",
      recovery: "recovery_required",
      halted: true,
    });
    // Nothing was written to the store before validation.
    expect(store.listByResource(`ws:${TENANT}:user:${USER}:asset:${ASSET}`)).toHaveLength(0);
  });

  it("fails closed for a non-enterprise domain", () => {
    const result = provisionEmployeeStewardCutoverWorkspace(
      validRequest({ tenantContext: { tenantId: TENANT, userId: USER, domain: "employee" } }),
    );
    expect(result).toMatchObject({ ok: false, reason: "missing_tenant_context" });
  });

  it("fails closed when the actor is missing", () => {
    const result = provisionEmployeeStewardCutoverWorkspace(validRequest({ actor: null }));
    expect(result).toMatchObject({ ok: false, reason: "missing_actor" });
  });

  it("fails closed when the actor does not match the trusted subject", () => {
    const result = provisionEmployeeStewardCutoverWorkspace(
      validRequest({ actor: { userId: "someone-else" } }),
    );
    expect(result).toMatchObject({ ok: false, reason: "actor_owner_mismatch" });
  });

  it("fails closed when the ownership proof is missing", () => {
    const result = provisionEmployeeStewardCutoverWorkspace(validRequest({ ownershipProof: null }));
    expect(result).toMatchObject({ ok: false, reason: "missing_ownership_proof" });
  });

  it("fails closed when the ownership proof owner does not match", () => {
    const result = provisionEmployeeStewardCutoverWorkspace(
      validRequest({
        ownershipProof: {
          source: "explicit_binding",
          ownerType: "user",
          ownerId: "other",
          agentAssetId: ASSET,
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "ownership_proof_mismatch" });
  });

  it("fails closed when the ownership proof is a registry (non-explicit) proof", () => {
    const result = provisionEmployeeStewardCutoverWorkspace(
      validRequest({
        ownershipProof: {
          source: "registry",
          ownerType: "user",
          ownerId: USER,
          agentAssetId: ASSET,
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "missing_ownership_proof" });
  });

  it("fails closed when the placement roots are missing", () => {
    const result = provisionEmployeeStewardCutoverWorkspace(
      validRequest({ sourceRoot: "", targetRoot: "" }),
    );
    expect(result).toMatchObject({ ok: false, reason: "missing_placement" });
  });

  it("fails closed when a placement root is not absolute", () => {
    const result = provisionEmployeeStewardCutoverWorkspace(
      validRequest({ sourceRoot: "relative/src", targetRoot: path.join(tmpStateDir(), "t") }),
    );
    expect(result).toMatchObject({ ok: false, reason: "placement_not_absolute" });
  });

  it("fails closed when a placement root escapes via ..", () => {
    const result = provisionEmployeeStewardCutoverWorkspace(
      validRequest({
        sourceRoot: "/tmp/steward-cutover-esc/../escape",
        targetRoot: path.join(tmpStateDir(), "t"),
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "placement_path_escape" });
  });

  it("fails closed when source and target placement collide", () => {
    const stateDir = tmpStateDir();
    const root = path.join(stateDir, "same");
    const result = provisionEmployeeStewardCutoverWorkspace(
      validRequest({ placementRoot: stateDir, sourceRoot: root, targetRoot: root }),
    );
    expect(result).toMatchObject({ ok: false, reason: "placement_source_target_collision" });
  });

  it("fails closed when placement escapes the allowed root", () => {
    const stateDir = tmpStateDir();
    const outside = tmpStateDir();
    const result = provisionEmployeeStewardCutoverWorkspace(
      validRequest({
        placementRoot: stateDir,
        sourceRoot: path.join(outside, "source"),
        targetRoot: path.join(stateDir, "target"),
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "placement_outside_allowed_root" });
  });

  it("fails closed when the allowed root does not exist", () => {
    const missing = path.join(os.tmpdir(), "provision-missing-root-xyz-42");
    const result = provisionEmployeeStewardCutoverWorkspace(
      validRequest({
        placementRoot: missing,
        sourceRoot: path.join(missing, "source"),
        targetRoot: path.join(missing, "target"),
      }),
    );
    expect(result).toMatchObject({ ok: false, reason: "placement_root_missing" });
  });

  it("fences concurrent operations: rejects a different operation on the same resource", () => {
    const store = new InMemoryWorkspaceCutoverStore();
    const first = provisionEmployeeStewardCutoverWorkspace(
      validRequest({ cutoverStore: store, operationId: "op-fence-1" }),
    );
    expect(first.ok).toBe(true);
    const second = provisionEmployeeStewardCutoverWorkspace(
      validRequest({ cutoverStore: store, operationId: "op-fence-2" }),
    );
    expect(second).toMatchObject({ ok: false, reason: "concurrent_operation" });
  });

  it("allows an idempotent same-id resume on the same resource", () => {
    const store = new InMemoryWorkspaceCutoverStore();
    const first = provisionEmployeeStewardCutoverWorkspace(
      validRequest({ cutoverStore: store, operationId: "op-resume" }),
    );
    expect(first.ok).toBe(true);
    const again = provisionEmployeeStewardCutoverWorkspace(
      validRequest({ cutoverStore: store, operationId: "op-resume" }),
    );
    expect(again.ok).toBe(true);
  });

  it("never clobbers an already-published target on materialize", () => {
    const stateDir = tmpStateDir();
    const sourceRoot = path.join(stateDir, "source");
    const targetRoot = path.join(stateDir, "target");
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.writeFileSync(path.join(targetRoot, "keep.md"), "keep");
    const result = provisionEmployeeStewardCutoverWorkspace(
      validRequest({ placementRoot: stateDir, sourceRoot, targetRoot, materialize: true }),
    );
    expect(result).toMatchObject({ ok: false, reason: "target_exists" });
    expect(fs.readFileSync(path.join(targetRoot, "keep.md"), "utf8")).toBe("keep");
  });

  it("records the placement handle and staging root on a materialized provision", () => {
    const result = provisionEmployeeStewardCutoverWorkspace(validRequest({ materialize: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.receipt.placement.tenantId).toBe(TENANT);
    expect(result.receipt.placement.resourceId).toBe(result.resourceId);
    expect(typeof result.receipt.stagingRoot).toBe("string");
    expect(result.receipt.quarantinePath).toBeNull();
  });
});
