import { beforeEach, expect, it, vi } from "vitest";
import { createCommandAdmissionSession } from "./command-admission-session.js";
const m = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  forget: vi.fn(),
  remember: vi.fn(),
  build: vi.fn(),
  credit: vi.fn(),
}));
vi.mock("./command-commercial-gate.js", () => ({
  acquireAgentCommandCommercialRun: m.acquire,
  releaseAgentCommandCommercialRun: m.release,
}));
vi.mock("../../gateway/governance/spawn-snapshot-handoff.js", () => ({
  forgetRunModelSet: m.forget,
  rememberRunModelSet: m.remember,
  buildRunModelSetSnapshot: m.build,
  snapshotCreditReportingFromGate: m.credit,
}));
beforeEach(() => {
  vi.resetAllMocks();
  m.build.mockReturnValue({ runId: "run" });
});
it("acquired parent snapshots once and releases before forgetting", async () => {
  m.acquire.mockResolvedValue({
    status: "acquired",
    enterpriseId: "tenant",
    authorizationDecisionId: "auth",
    modelGate: { allowlist: ["openai/gpt-5"] },
  });
  const s = createCommandAdmissionSession({ runId: "run", isSubagentLane: false, entry: "E2" });
  await s.acquire({ runId: "run", sessionAgentId: "main", entry: "E2" });
  expect(m.remember).toHaveBeenCalledTimes(1);
  expect(s.fallbackGovernance()).toMatchObject({
    governanceContext: { entry: "E2", tenantId: "tenant" },
  });
  s.dispose();
  s.dispose();
  expect(m.release).toHaveBeenCalledTimes(1);
  expect(m.release.mock.invocationCallOrder[0]).toBeLessThan(m.forget.mock.invocationCallOrder[0]);
});
it("child acquires E6 quota without replacing inherited model snapshot", async () => {
  m.acquire.mockResolvedValue({ status: "acquired" });
  const s = createCommandAdmissionSession({ runId: "run", isSubagentLane: true });
  await s.acquire({ runId: "run", sessionAgentId: "child", entry: "E6" });
  expect(m.acquire).toHaveBeenCalledWith(expect.objectContaining({ entry: "E6" }));
  expect(m.build).not.toHaveBeenCalled();
  expect(s.fallbackGovernance()).toEqual({});
  s.dispose();
});
it.each(["denied", "skipped"])("%s never releases an unheld slot", async (status) => {
  m.acquire.mockResolvedValue({ status });
  const s = createCommandAdmissionSession({ runId: "run", isSubagentLane: false });
  await s.acquire({ runId: "run", sessionAgentId: "main" });
  s.dispose();
  expect(m.release).not.toHaveBeenCalled();
  expect(m.forget).not.toHaveBeenCalled();
});
