import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock CONFIG_DIR to use a temp directory
const tmpDir = path.join(os.tmpdir(), `openbot-gov-test-${Date.now()}`);
vi.mock("../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const {
  approveAndRegister,
  getProposal,
  getRegistryEntry,
  listProposals,
  listRegistry,
  registerCapability,
  syncRegistryBatch,
  submitProposal,
  submitProposalBatch,
  updateProposalStatus,
  updateRegistryDistribution,
  updateRegistryLifecycle,
} = await import("./capability-governance-store.js");

function makeManifest(id: string) {
  return {
    id: `urn:openclaw:skill:${id}@1.0.0`,
    kind: "skill",
    version: "1.0.0",
    skillKey: id,
    name: id,
    description: `${id} skill`,
    source: { kind: "npm", origin: `@openclaw/skill-${id}`, trustTier: "first-party" },
    risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
  };
}

function makeProposal(id: string) {
  return {
    proposalId: `proposal:${id}`,
    submittedAt: "2026-05-11T00:00:00Z",
    submittedBy: "npm",
    status: "proposed" as const,
    manifest: makeManifest(id),
    findings: [],
  };
}

describe("capability-governance-store", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    // Clean governance dir
    const govDir = path.join(tmpDir, "governance");
    if (fs.existsSync(govDir)) {
      fs.rmSync(govDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("starts with empty proposals and registry", () => {
    expect(listProposals()).toEqual([]);
    expect(listRegistry()).toEqual([]);
  });

  it("submits and retrieves a proposal", () => {
    const proposal = makeProposal("weather");
    submitProposal(proposal);

    const all = listProposals();
    expect(all).toHaveLength(1);
    expect(all[0].proposalId).toBe("proposal:weather");

    const found = getProposal("proposal:weather");
    expect(found).not.toBeNull();
    expect(found!.manifest.skillKey).toBe("weather");
  });

  it("deduplicates proposals by proposalId", () => {
    const proposal = makeProposal("weather");
    submitProposal(proposal);
    submitProposal({ ...proposal, submittedBy: "updated" });

    const all = listProposals();
    expect(all).toHaveLength(1);
    expect(all[0].submittedBy).toBe("updated");
  });

  it("submits a batch of proposals", () => {
    const batch = [makeProposal("a"), makeProposal("b"), makeProposal("c")];
    submitProposalBatch(batch);

    expect(listProposals()).toHaveLength(3);
  });

  it("updates proposal status", () => {
    submitProposal(makeProposal("weather"));
    const updated = updateProposalStatus("proposal:weather", "under_review", { id: "admin" });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("under_review");
    expect(updated!.reviewer?.id).toBe("admin");
  });

  it("returns null when updating non-existent proposal", () => {
    const result = updateProposalStatus("proposal:nonexistent", "rejected", { id: "admin" });
    expect(result).toBeNull();
  });

  it("registers a capability into the registry", () => {
    const manifest = makeManifest("github");
    const entry = registerCapability(manifest);

    expect(entry.lifecycleState).toBe("active");
    expect(entry.distribution.defaultEnabled).toBe(true);
    expect(listRegistry()).toHaveLength(1);

    const found = getRegistryEntry(manifest.id);
    expect(found).not.toBeNull();
    expect(found!.manifest.skillKey).toBe("github");
  });

  it("updates registry lifecycle state", () => {
    registerCapability(makeManifest("github"));
    const updated = updateRegistryLifecycle("urn:openclaw:skill:github@1.0.0", "deprecated");

    expect(updated).not.toBeNull();
    expect(updated!.lifecycleState).toBe("deprecated");
  });

  it("updates registry distribution", () => {
    registerCapability(makeManifest("github"));
    const updated = updateRegistryDistribution(
      "urn:openclaw:skill:github@1.0.0",
      { tenantIds: ["tenant-a", "tenant-b"] },
      false,
      "direct_employee_visible",
      "admin",
    );

    expect(updated).not.toBeNull();
    expect(updated!.distribution.scope.tenantIds).toEqual(["tenant-a", "tenant-b"]);
    expect(updated!.distribution.defaultEnabled).toBe(false);
    expect(updated!.distribution.employeeVisibilityMode).toBe("direct_employee_visible");
    expect(updated!.distribution.updatedBy).toBe("admin");
  });

  it("defaults legacy and new registry entries to enterprise review required visibility", () => {
    const entry = registerCapability(makeManifest("github"));
    expect(entry.distribution.employeeVisibilityMode).toBe("enterprise_review_required");

    const listed = listRegistry();
    expect(listed[0]?.distribution.employeeVisibilityMode).toBe("enterprise_review_required");
  });

  it("syncs a manifest batch into registry without duplicating existing entries", () => {
    registerCapability(makeManifest("github"));

    const result = syncRegistryBatch([makeManifest("github"), makeManifest("weather")]);

    expect(result).toHaveLength(2);
    expect(listRegistry()).toHaveLength(2);
    expect(
      listRegistry()
        .map((entry) => entry.manifest.skillKey)
        .toSorted(),
    ).toEqual(["github", "weather"]);
  });

  it("approves a proposal and registers the manifest", () => {
    submitProposal(makeProposal("weather"));
    const result = approveAndRegister("proposal:weather", "admin", "Looks good");

    expect(result).not.toBeNull();
    expect(result!.proposal.status).toBe("approved");
    expect(result!.proposal.resolvedManifestId).toBe("urn:openclaw:skill:weather@1.0.0");
    expect(result!.entry.lifecycleState).toBe("active");
    expect(listRegistry()).toHaveLength(1);
  });

  it("returns null when approving non-existent proposal", () => {
    const result = approveAndRegister("proposal:nonexistent", "admin");
    expect(result).toBeNull();
  });
});
