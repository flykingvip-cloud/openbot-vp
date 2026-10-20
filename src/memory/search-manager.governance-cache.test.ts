import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  buildMemorySearchGovernanceFromCallEntry,
  fingerprintMemoryGovernance,
  getMemoryGovernanceEpoch,
  resetMemoryGovernanceEpochForTests,
} from "./memory-search-governance.js";
import {
  getMemorySearchManager,
  invalidateCogniWeaveManagersForGovernanceChangeSync,
} from "./search-manager.js";

const createMock = vi.hoisted(() => vi.fn());

vi.mock("./cogniweave-manager.js", () => ({
  CogniWeaveMemoryManager: {
    create: (...args: unknown[]) => createMock(...args),
  },
}));

vi.mock("./backend-config.js", async () => {
  const actual = await vi.importActual<typeof import("./backend-config.js")>("./backend-config.js");
  return {
    ...actual,
    resolveMemoryBackendConfig: () => ({
      backend: "cogniweave" as const,
      cogniweave: {
        mode: "embedded",
        storePath: "/tmp/cw-test.sqlite",
        sources: ["memory"],
        writeSync: "disabled",
        cloudSync: {
          enabled: true,
          endpoint: "https://example.test",
          tenantId: "tenant-acme",
        },
      },
    }),
  };
});

function managerStub() {
  return {
    search: vi.fn(async () => []),
    readFile: vi.fn(async () => ({ text: "", path: "MEMORY.md" })),
    status: vi.fn(() => ({
      backend: "cogniweave",
      provider: "cogniweave",
      model: "cogniweave",
      requestedProvider: "cogniweave",
      files: 0,
      chunks: 0,
      dirty: false,
      workspaceDir: "/tmp",
      dbPath: "/tmp/cw.sqlite",
    })),
    sync: vi.fn(async () => {}),
    probeEmbeddingAvailability: vi.fn(async () => ({ ok: true })),
    probeVectorAvailability: vi.fn(async () => true),
    close: vi.fn(async () => {}),
  };
}

afterEach(async () => {
  resetMemoryGovernanceEpochForTests();
  createMock.mockReset();
  invalidateCogniWeaveManagersForGovernanceChangeSync();
  resetMemoryGovernanceEpochForTests();
});

describe("CogniWeave manager governance cache (P1-2 round 3)", () => {
  it("fail-closes managed cloud tenant without ownership proof", async () => {
    const cfg = {} as OpenBotConfig;
    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    expect(result.manager).toBeNull();
    expect(result.error).toMatch(/missing_ownership_proof/);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("cache key includes governance fingerprint; seat transfer epoch invalidates", async () => {
    const cfg = {} as OpenBotConfig;
    const seatA = buildMemorySearchGovernanceFromCallEntry({
      tenantId: "tenant-acme",
      seatId: "seat-a",
      userId: "u1",
    })!;
    const seatB = buildMemorySearchGovernanceFromCallEntry({
      tenantId: "tenant-acme",
      seatId: "seat-b",
      userId: "u1",
    })!;
    expect(fingerprintMemoryGovernance(seatA)).not.toBe(fingerprintMemoryGovernance(seatB));

    const firstStub = managerStub();
    const secondStub = managerStub();
    createMock.mockResolvedValueOnce(firstStub).mockResolvedValueOnce(secondStub);

    const first = await getMemorySearchManager({
      cfg,
      agentId: "main",
      governance: seatA,
    });
    const cached = await getMemorySearchManager({
      cfg,
      agentId: "main",
      governance: seatA,
    });
    expect(first.manager).toBe(cached.manager);
    expect(createMock).toHaveBeenCalledTimes(1);

    const epochBefore = getMemoryGovernanceEpoch();
    invalidateCogniWeaveManagersForGovernanceChangeSync();
    expect(getMemoryGovernanceEpoch()).toBe(epochBefore + 1);
    await Promise.resolve();
    expect(firstStub.close).toHaveBeenCalled();

    const afterTransfer = await getMemorySearchManager({
      cfg,
      agentId: "main",
      governance: seatB,
    });
    expect(afterTransfer.manager).toBeTruthy();
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[1]?.[0]?.governance?.ownershipProof.owner).toMatchObject({
      kind: "position",
      seatId: "seat-b",
    });
  });
});
