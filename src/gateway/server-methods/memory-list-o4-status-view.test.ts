/**
 * O4 data.memory.list statusView wiring — evidence: mock-config-identity-branch.
 * Covers C1/C2/C3/C4/C6 handler seams without real memory writes / syncScope.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({ dataSpace: { mode: "local" } }),
}));

vi.mock("../../config/data-space.js", () => ({
  isManagedDataMode: () => false,
  resolveDataRoot: () => "/tmp/unused-o4",
}));

vi.mock("../../data/memory-list.js", () => ({
  listAgentMemoryEntries: vi.fn(async () => ({ entries: [] })),
}));

vi.mock("../employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: vi.fn(async () => null),
}));

vi.mock("./memory-center-access.js", () => ({
  assertMemoryCenterAgentAccess: vi.fn(async () => true),
}));

const getMemorySearchManager = vi.fn();
vi.mock("../../memory/search-manager.js", () => ({
  getMemorySearchManager: (...args: unknown[]) => getMemorySearchManager(...args),
  buildMemorySearchGovernanceFromCallEntry: vi.fn(),
}));

import { dataHandlers } from "./data.js";

function captureRespond() {
  const calls: Array<{ ok: boolean; payload: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { respond, calls };
}

describe("data.memory.list O4 statusView wiring", () => {
  it("C4/C6: defaults to active and returns exact readonly atoms", async () => {
    const listMemoryCenterAtomsReadonly = vi.fn(async (opts?: { statusView?: string }) => ({
      ok: true as const,
      statusView: (opts?.statusView ?? "active") as "active",
      atoms: [
        {
          id: "a1",
          summary: "active atom",
          atomType: "preference",
          scope: { kind: "agent" as const, visibility: "private" as const, agentId: "main" },
          botId: "main",
          syncEligible: false,
          shared: false,
          status: "active",
          updatedAtMs: 1,
        },
      ],
      total: 1,
      truncated: false,
    }));
    getMemorySearchManager.mockResolvedValue({
      manager: { listMemoryCenterAtomsReadonly },
    });
    const { respond, calls } = captureRespond();
    await dataHandlers["data.memory.list"]({
      params: { agentId: "main" },
      respond,
      client: null,
    } as never);
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as {
      statusView: string;
      atoms: Array<{ id: string }>;
      atomList: { ok: boolean; statusView: string; total: number };
    };
    expect(payload.statusView).toBe("active");
    expect(payload.atoms.map((a) => a.id)).toEqual(["a1"]);
    expect(payload.atomList).toMatchObject({ ok: true, statusView: "active", total: 1 });
    expect(listMemoryCenterAtomsReadonly).toHaveBeenCalledWith({
      statusView: "active",
      limit: 200,
    });
  });

  it("C2: tentative statusView uses readonly foundation (not legacy includeTentative)", async () => {
    const listMemoryCenterAtomsReadonly = vi.fn(async () => ({
      ok: true as const,
      statusView: "tentative" as const,
      atoms: [
        {
          id: "t1",
          summary: "candidate",
          atomType: "preference",
          scope: { kind: "agent" as const, visibility: "private" as const, agentId: "main" },
          botId: "main",
          syncEligible: false,
          shared: false,
          status: "tentative",
          updatedAtMs: 1,
        },
      ],
      total: 1,
      truncated: false,
    }));
    const listMemoryCenterAtoms = vi.fn(async () => {
      throw new Error("legacy list must not run for tentative");
    });
    getMemorySearchManager.mockResolvedValue({
      manager: { listMemoryCenterAtomsReadonly, listMemoryCenterAtoms },
    });
    const { respond, calls } = captureRespond();
    await dataHandlers["data.memory.list"]({
      params: { agentId: "main", statusView: "tentative" },
      respond,
      client: null,
    } as never);
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as {
      statusView: string;
      atoms: Array<{ status: string }>;
    };
    expect(payload.statusView).toBe("tentative");
    expect(payload.atoms[0]?.status).toBe("tentative");
    expect(listMemoryCenterAtoms).not.toHaveBeenCalled();
  });

  it("C1: empty active view probes sibling tentative total for empty-state hint", async () => {
    const listMemoryCenterAtomsReadonly = vi.fn(
      async (opts?: { statusView?: string; limit?: number }) => {
        if (opts?.statusView === "tentative") {
          return {
            ok: true as const,
            statusView: "tentative" as const,
            atoms: [],
            total: 3,
            truncated: false,
          };
        }
        return {
          ok: true as const,
          statusView: "active" as const,
          atoms: [],
          total: 0,
          truncated: false,
        };
      },
    );
    getMemorySearchManager.mockResolvedValue({
      manager: { listMemoryCenterAtomsReadonly },
    });
    const { respond, calls } = captureRespond();
    await dataHandlers["data.memory.list"]({
      params: { agentId: "main", statusView: "active" },
      respond,
      client: null,
    } as never);
    const payload = calls[0]?.payload as {
      atomList: { ok: true; total: number; otherViewTotal?: number };
    };
    expect(payload.atomList.ok).toBe(true);
    expect(payload.atomList.total).toBe(0);
    expect(payload.atomList.otherViewTotal).toBe(3);
    expect(listMemoryCenterAtomsReadonly).toHaveBeenCalledTimes(2);
  });

  it("C3: unbound is explicit atomList error, not silent empty success atoms only", async () => {
    const listMemoryCenterAtomsReadonly = vi.fn(async () => ({
      ok: false as const,
      code: "MEMORY_SUBJECT_UNBOUND",
      message: "memory subject authorization denied: UNBOUND",
    }));
    getMemorySearchManager.mockResolvedValue({
      manager: { listMemoryCenterAtomsReadonly },
    });
    const { respond, calls } = captureRespond();
    await dataHandlers["data.memory.list"]({
      params: { agentId: "main", statusView: "tentative" },
      respond,
      client: null,
    } as never);
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as {
      atoms: unknown[];
      atomList: { ok: false; code: string };
    };
    expect(payload.atoms).toEqual([]);
    expect(payload.atomList).toMatchObject({
      ok: false,
      code: "MEMORY_SUBJECT_UNBOUND",
    });
  });
});
