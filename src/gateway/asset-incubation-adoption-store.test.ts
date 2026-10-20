import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-asset-adoption-${Date.now()}`);

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const {
  countUserInitiatedSaves,
  linkContextToCapability,
  recordAdoptionSignal,
  recordAdminRecommendForCapability,
  recordUserInitiatedSave,
  summarizeAdoptionEvidence,
} = await import("./asset-incubation-adoption-store.js");

function cleanStore(): void {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

describe("asset-incubation-adoption-store", () => {
  beforeEach(() => {
    cleanStore();
  });

  afterEach(() => {
    cleanStore();
  });

  it("summarizes adoption from signals", () => {
    recordAdoptionSignal({
      ownerKey: "user-a",
      capabilityId: "cap-1",
      kind: "share_to_group",
      memberId: "group-1",
    });
    recordAdoptionSignal({
      ownerKey: "user-a",
      capabilityId: "cap-1",
      kind: "member_use",
      memberId: "agent-a",
    });
    recordAdoptionSignal({
      ownerKey: "user-a",
      capabilityId: "cap-1",
      kind: "member_use",
      memberId: "agent-b",
    });

    const summary = summarizeAdoptionEvidence({
      ownerKey: "user-a",
      capabilityId: "cap-1",
    });
    expect(summary.sharedToGroup).toBe(true);
    expect(summary.distinctMemberCount).toBe(2);
  });

  it("aggregates member_use across owners for the same capability", () => {
    recordAdoptionSignal({
      ownerKey: "user-a",
      capabilityId: "cap-shared",
      kind: "member_use",
      memberId: "member-1",
    });
    recordAdoptionSignal({
      ownerKey: "user-b",
      capabilityId: "cap-shared",
      kind: "member_use",
      memberId: "member-2",
    });
    recordAdoptionSignal({
      ownerKey: "user-b",
      capabilityId: "cap-shared",
      kind: "member_use",
      memberId: "member-3",
    });

    const summary = summarizeAdoptionEvidence({
      ownerKey: "user-a",
      capabilityId: "cap-shared",
    });
    expect(summary.distinctMemberCount).toBe(3);
  });

  it("marks admin_recommend from platform for any owner query", () => {
    recordAdminRecommendForCapability({
      capabilityId: "cap-admin",
      ownerKey: "platform",
      recommenderId: "reviewer-1",
    });

    const summary = summarizeAdoptionEvidence({
      ownerKey: "user-a",
      capabilityId: "cap-admin",
    });
    expect(summary.adminRecommended).toBe(true);
  });

  it("resolves adoption by linked contextId", () => {
    linkContextToCapability({
      ownerKey: "user-a",
      contextId: "artifact-1",
      capabilityId: "cap-1",
    });
    recordAdoptionSignal({
      ownerKey: "user-a",
      capabilityId: "cap-1",
      kind: "enterprise_submit",
    });

    const summary = summarizeAdoptionEvidence({
      ownerKey: "user-a",
      contextId: "artifact-1",
    });
    expect(summary.enterpriseSubmitted).toBe(true);
  });

  it("counts user initiated saves by context", () => {
    recordUserInitiatedSave({ ownerKey: "user-a", contextId: "artifact-1" });
    recordUserInitiatedSave({ ownerKey: "user-a", contextId: "artifact-1" });
    expect(countUserInitiatedSaves({ ownerKey: "user-a", contextId: "artifact-1" })).toBe(2);
  });
});
