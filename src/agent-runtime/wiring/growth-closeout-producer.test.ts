import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  authorized: vi.fn(),
  boundary: vi.fn(),
  metrics: vi.fn(),
  skills: vi.fn(),
  enqueue: vi.fn(),
}));
vi.mock("../../agents/agent-scope.js", () => ({ resolveAgentDir: mocks.configured }));
vi.mock("../../gateway/tenant-store-paths.js", () => ({
  resolveTenantAgentDirForContext: mocks.authorized,
  assertWithinTenantRoot: mocks.boundary,
}));
vi.mock("../state/postgres/operational-metrics.js", () => ({
  rebuildOperationalMetrics: mocks.metrics,
}));
vi.mock("../../gateway/skill-lifecycle-store.js", () => ({
  listTenantRobotSkillAssets: mocks.skills,
}));
vi.mock("../state/postgres/growth-event-producer.js", () => ({
  enqueueOperationalGrowth: mocks.enqueue,
}));
import { produceCloseoutGrowth } from "./growth-closeout-producer.js";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue("/tmp/authorized-agent");
  mocks.authorized.mockReturnValue("/tmp/authorized-agent");
  mocks.metrics.mockResolvedValue({ updatedAtMs: 10, tasksTotal: 1 });
  mocks.skills.mockReturnValue([{ id: "skill", enabled: true }]);
  mocks.enqueue.mockResolvedValue(undefined);
});
function input() {
  return {
    cfg: {},
    tenantId: "tenant",
    executionId: "execution",
    agentId: "agent",
    principalId: "principal",
    db: {
      query: vi.fn(async () => ({
        rows: [{ user_id: "user", domain: "enterprise", agent_ids: ["agent"] }],
        rowCount: 1,
      })),
    },
  };
}
it("enqueues original trusted execution snapshot only after grant and directory checks", async () => {
  const value = input();
  await produceCloseoutGrowth(value);
  expect(mocks.boundary).toHaveBeenCalledTimes(1);
  expect(mocks.enqueue).toHaveBeenCalledWith(
    value.db,
    expect.objectContaining({
      tenantId: "tenant",
      executionId: "execution",
      eventId: "growth-closeout:execution",
      agentId: "agent",
      observedAtMs: 10,
      installedSkillKeys: ["skill"],
    }),
  );
});
it("rejects global/tenant mismatch before reading operational or skill data", async () => {
  mocks.configured.mockReturnValue("/tmp/global-agent");
  await expect(produceCloseoutGrowth(input())).rejects.toThrow("does not match");
  expect(mocks.metrics).not.toHaveBeenCalled();
  expect(mocks.skills).not.toHaveBeenCalled();
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it("surfaces enqueue failure instead of reporting successful growth delivery", async () => {
  mocks.enqueue.mockRejectedValueOnce(new Error("Outbox unavailable"));
  await expect(produceCloseoutGrowth(input())).rejects.toThrow("Outbox unavailable");
});
