import { DatabaseSync } from "node:sqlite";
import { beforeEach, expect, it, vi } from "vitest";
import {
  generateHierarchicalSummary,
  SummaryGenerationDeferred,
} from "./retrieval-summary-hierarchy.js";
const m = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  usage: vi.fn(),
  complete: vi.fn(),
  resolve: vi.fn(),
  key: vi.fn(),
  enqueue: vi.fn(),
  done: vi.fn(),
}));
vi.mock("./knowledge-base-store.js", () => ({
  getKnowledgeBase: () => ({ ownerId: "owner", tenantId: "tenant", documentIds: ["doc"] }),
}));
vi.mock("../billing/usage-outbox-store.js", () => ({
  enqueueUsageOutbox: m.enqueue,
  markUsageOutboxDone: m.done,
}));
vi.mock("../../config/config.js", () => ({ loadConfig: () => ({}) }));
vi.mock("./../enterprise-seat-assets-store.js", () => ({
  buildEmployeeAccessSnapshot: () => ({ currentSeat: { seatId: "seat", status: "occupied" } }),
}));
vi.mock("../platform-auth/seat-store-loader.js", () => ({
  loadSeatAssetsStoreForTenantId: async () => ({
    seats: { seat: { seatId: "seat", tenantId: "tenant", currentEmployeeId: "owner" } },
    bindings: {
      binding: { seatId: "seat", tenantId: "tenant", employeeId: "owner", bindingStatus: "active" },
    },
  }),
}));
vi.mock("../billing/agent-run-governance.js", () => ({
  tryAcquireEnterpriseAgentRun: m.acquire,
  releaseEnterpriseAgentRun: m.release,
}));
vi.mock("../billing/record-credit-usage.js", () => ({ recordCreditUsage: m.usage }));
vi.mock("../../agents/pi-embedded-runner/model.js", () => ({ resolveModel: m.resolve }));
vi.mock("../../agents/model-auth.js", () => ({
  getApiKeyForModel: m.key,
  requireApiKey: () => "test-key",
}));
vi.mock("@earendil-works/pi-ai/compat", () => ({ completeSimple: m.complete }));
import { createRetrievalSummaryGenerationAuthority } from "./retrieval-summary-authority.js";
beforeEach(() => {
  vi.resetAllMocks();
  m.enqueue.mockResolvedValue({ id: "receipt" });
});
const input = { kbId: "kb", tenantId: "tenant", ownerId: "owner", docId: "doc" };
it("denies unknown scope and commercial budget refusal without resolving model credentials", async () => {
  const authority = createRetrievalSummaryGenerationAuthority();
  expect(await authority.authorize({ ...input, tenantId: null })).toBeUndefined();
  m.acquire.mockResolvedValue({ acquired: false, skipped: false });
  expect(await authority.authorize(input)).toBeUndefined();
  expect(m.resolve).not.toHaveBeenCalled();
  expect(m.key).not.toHaveBeenCalled();
});
it("selects only entitled models and charges usage to the same tenant and seat", async () => {
  m.acquire.mockResolvedValue({
    acquired: true,
    enterpriseId: "tenant",
    modelGate: {
      allowlist: ["provider/allowed"],
      preferredModelOrder: ["provider/forbidden", "provider/allowed"],
      creditReporting: { enterpriseId: "tenant", policyId: "policy" },
    },
  });
  m.resolve.mockResolvedValue({ model: {} });
  m.complete.mockResolvedValue({
    content: [{ type: "text", text: "{}" }],
    usage: { input: 10, output: 5 },
  });
  const grant = await createRetrievalSummaryGenerationAuthority().authorize(input);
  expect(grant).toBeDefined();
  const response = await grant!.llm({ prompt: "synthetic" });
  expect(response?.inputTokens).toBe(10);
  expect(m.resolve).toHaveBeenCalledWith("provider", "allowed", undefined, {});
  await grant!.charge({ inputTokens: 10, outputTokens: 5 });
  expect(m.usage).toHaveBeenCalledWith(
    expect.objectContaining({
      enterpriseId: "tenant",
      orgSeatId: "seat",
      userId: "owner",
      modelId: "provider/allowed",
    }),
  );
  expect(m.release).toHaveBeenCalledTimes(1);
});

it("releases central concurrency on provider failure and never invents zero-token usage", async () => {
  m.acquire.mockResolvedValue({
    acquired: true,
    enterpriseId: "tenant",
    modelGate: {
      allowlist: ["provider/allowed"],
      creditReporting: { enterpriseId: "tenant", policyId: "policy" },
    },
  });
  m.resolve.mockResolvedValue({ model: {} });
  m.complete.mockRejectedValue(Error("transport"));
  const grant = await createRetrievalSummaryGenerationAuthority().authorize(input);
  await expect(grant!.llm({ prompt: "synthetic" })).rejects.toThrow("transport");
  expect(m.release).toHaveBeenCalledTimes(1);
  expect(m.usage).not.toHaveBeenCalled();
});

it.each(["admission", "creditReporting", "modelGate"] as const)(
  "rejects %s tenant mismatch before credentials or model access",
  async (kind) => {
    m.acquire.mockResolvedValue({
      acquired: true,
      enterpriseId: kind === "admission" ? "foreign" : "tenant",
      modelGate: {
        tenantId: kind === "modelGate" ? "foreign" : "tenant",
        allowlist: ["provider/allowed"],
        creditReporting: {
          enterpriseId: kind === "creditReporting" ? "foreign" : "tenant",
          policyId: "policy",
        },
      },
    });
    expect(await createRetrievalSummaryGenerationAuthority().authorize(input)).toBeUndefined();
    expect(m.release).toHaveBeenCalledTimes(1);
    expect(m.key).not.toHaveBeenCalled();
    expect(m.complete).not.toHaveBeenCalled();
  },
);
it("persists paid sections after durable usage acceptance even when immediate settlement fails", async () => {
  const db = new DatabaseSync(":memory:");
  let budget = 1;
  const pending = new Set<string>();
  m.enqueue.mockImplementation(async (payload) => {
    pending.add(payload.taskId);
    return { id: payload.taskId };
  });
  m.done.mockImplementation(async (id) => {
    pending.delete(id);
  });
  m.usage.mockRejectedValueOnce(Error("settlement unavailable")).mockResolvedValue(undefined);
  m.acquire.mockResolvedValue({
    acquired: true,
    enterpriseId: "tenant",
    modelGate: {
      allowlist: ["provider/allowed"],
      creditReporting: { enterpriseId: "tenant", policyId: "policy" },
    },
  });
  m.resolve.mockResolvedValue({ model: {} });
  const fields = {
    purpose: "summary",
    keyPoints: ["tail"],
    coverage: [],
    entities: [],
    boundaries: [],
  };
  m.complete.mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify(fields) }],
    usage: { input: 10, output: 5 },
  });
  const authority = createRetrievalSummaryGenerationAuthority();
  const task = {
    db,
    docId: "doc",
    versionId: "v1",
    contentHash: "h1",
    body: "a".repeat(12000) + "tail",
    documentType: "report" as const,
    call: async (prompt: string) => {
      if (budget-- <= 0) {
        return undefined;
      }
      const grant = await authority.authorize(input);
      const result = await grant!.llm({ prompt });
      await grant!.charge({ inputTokens: result!.inputTokens, outputTokens: result!.outputTokens });
      return result!.text;
    },
  };
  await expect(generateHierarchicalSummary(task)).rejects.toBeInstanceOf(SummaryGenerationDeferred);
  expect(db.prepare("SELECT count(*) AS count FROM retrieval_summary_sections").get()?.count).toBe(
    1,
  );
  expect(pending.size).toBe(1);
  budget = 2;
  expect(await generateHierarchicalSummary(task)).toEqual(fields);
  expect(m.complete).toHaveBeenCalledTimes(3);
  expect(m.enqueue).toHaveBeenCalledTimes(3);
  expect(pending.size).toBe(1);
  db.close();
});
it("rejects usage when the durable outbox itself cannot accept it", async () => {
  m.acquire.mockResolvedValue({
    acquired: true,
    enterpriseId: "tenant",
    modelGate: {
      allowlist: ["provider/allowed"],
      creditReporting: { enterpriseId: "tenant", policyId: "policy" },
    },
  });
  m.enqueue.mockRejectedValue(Error("outbox disk unavailable"));
  const grant = await createRetrievalSummaryGenerationAuthority().authorize(input);
  await expect(grant!.charge({ inputTokens: 10, outputTokens: 5 })).rejects.toThrow(
    "outbox disk unavailable",
  );
  expect(m.usage).not.toHaveBeenCalled();
  expect(m.done).not.toHaveBeenCalled();
});
