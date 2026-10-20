import { describe, expect, it, vi } from "vitest";
import {
  refreshCapabilityGovernanceSnapshot,
  type CapabilityGovernanceSnapshotHost,
} from "./capability-governance-gateway.ts";

describe("capability governance gateway snapshot", () => {
  it("loads persisted discovery proposals into platform state", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "capabilities.governance.listProposals") {
        return {
          proposals: [
            {
              proposalId: "proposal:github-url:anthropics/skills:skills/skill-creator@0.0.0",
              submittedAt: "2026-05-21T10:00:00.000Z",
              submittedBy: "github-url",
              status: "proposed",
              manifest: {
                id: "urn:openclaw:skill:skill-creator@0.0.0",
                kind: "skill",
                version: "0.0.0",
                skillKey: "skill-creator",
                name: "Skill Creator",
                description: "Imported from anthropics/skills",
                source: {
                  kind: "github",
                  origin: "https://github.com/anthropics/skills/tree/main/skills/skill-creator",
                  trustTier: "external",
                },
                interface: { inputs: [], outputs: [] },
                contracts: {
                  sideEffects: ["read_only"],
                  idempotent: true,
                  requiresConfirmation: false,
                },
                behavior: { costModel: "free" },
                requirements: { bins: [], env: [], configPaths: [], operatingSystems: [] },
                install: [],
                risk: {
                  level: "medium",
                  network: true,
                  filesystem: false,
                  subprocess: false,
                  secrets: false,
                },
              },
              findings: [],
            },
          ],
        };
      }
      if (method === "capabilities.governance.listRegistry") {
        return { entries: [] };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state: CapabilityGovernanceSnapshotHost = {
      client: { request } as unknown as CapabilityGovernanceSnapshotHost["client"],
      connected: true,
      capabilityGovernanceSnapshot: null,
      lastError: null,
    };

    await refreshCapabilityGovernanceSnapshot(state);

    expect(state.capabilityGovernanceSnapshot?.proposals).toHaveLength(1);
    expect(state.capabilityGovernanceSnapshot?.proposals[0]?.manifest.skillKey).toBe(
      "skill-creator",
    );
    expect(request).toHaveBeenCalledWith("capabilities.governance.listProposals", {});
    expect(request).toHaveBeenCalledWith("capabilities.governance.listRegistry", {});
  });
});
