import { beforeEach, expect, it, vi } from "vitest";
import { openCommandOutcomeEntry } from "./command-outcome-entry.js";
const m = vi.hoisted(() => ({ cli: vi.fn(), gateway: vi.fn(), child: vi.fn() }));
vi.mock("../../task-outcome/entrypoint-ensure.js", () => ({
  ensureCliTurnTaskOutcome: m.cli,
  ensureGatewayAgentTurnTaskOutcome: m.gateway,
  ensureSubagentTurnTaskOutcome: m.child,
}));
beforeEach(() => {
  vi.resetAllMocks();
  for (const fn of Object.values(m)) {
    fn.mockReturnValue({ ok: false });
  }
});
const base = { config: {}, agentId: "agent", runId: "run", isSubagentLane: false };
it("keeps CLI default identity and missing binding without fabricating state", () => {
  expect(openCommandOutcomeEntry(base)).toEqual({ entrypoint: "cli" });
  expect(m.cli).toHaveBeenCalledWith(
    {},
    { agentId: "agent", runId: "run", subjectRef: "subject:cli-operator" },
  );
});
it("prioritizes platform identity and session tenant on gateway entries", () => {
  openCommandOutcomeEntry({
    ...base,
    governanceEntry: "E2",
    platformUserId: " platform-user:p ",
    gatewayUser: "other",
    sessionTenantId: " tenant ",
    executionEnterpriseId: "other",
  });
  expect(m.gateway).toHaveBeenCalledWith(
    {},
    expect.objectContaining({ subjectRef: "platform-user:p", tenantId: "tenant" }),
  );
  expect(m.cli).not.toHaveBeenCalled();
});
it("subagent outranks E2 and preserves trimmed parent and binding", () => {
  const scope = { kind: "personal", personalDomainId: "p", subjectRef: "s", authzScopeRef: "a" };
  m.child.mockReturnValue({ ok: true, taskId: "task", scope });
  expect(
    openCommandOutcomeEntry({
      ...base,
      isSubagentLane: true,
      governanceEntry: "E2",
      parentTaskId: " parent ",
      gatewayUser: "user:opaque",
      sessionTenantId: " ",
      executionEnterpriseId: " enterprise ",
    }),
  ).toEqual({ entrypoint: "subagent", taskId: "task", scope });
  expect(m.child).toHaveBeenCalledWith(
    {},
    {
      agentId: "agent",
      runId: "run",
      subjectRef: "user:opaque",
      tenantId: "enterprise",
      parentTaskId: "parent",
    },
  );
  expect(m.gateway).not.toHaveBeenCalled();
});
