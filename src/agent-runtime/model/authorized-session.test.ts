import { expect, it, vi } from "vitest";
import { bindAdmittedTurnHost } from "../wiring/admitted-turn-host.js";
import { createAuthorizedModelSession } from "./index.js";

function setup() {
  const host = bindAdmittedTurnHost();
  host.admission.tryAcquireEnterpriseAgentRun = vi.fn(async () => ({
    acquired: true as const,
    skipped: false as const,
    enterpriseId: "tenant",
    authorizationDecisionId: "auth",
    subscriptionId: "subscription",
  }));
  host.admission.releaseEnterpriseAgentRun = vi.fn(async () => {});
  host.model.forgetRunModelSet = vi.fn();
  host.model.buildRunModelSetSnapshot = vi.fn(() => undefined);
  host.model.rememberRunModelSet = vi.fn();
  host.task.ensureChatTurnTaskOutcome = vi.fn();
  const session = createAuthorizedModelSession("model-call", host);
  const routing = host.model.resolveExecutionRoutingFromCapabilityPlan({});
  return { host, session, routing };
}
it("requires authorization before preparing model candidates, without creating a task", async () => {
  const { host, session, routing } = setup();
  expect(() => session.prepareModelSet({ config: {}, routing })).toThrow(/authorized/);
  await session.authorize({ agentId: "bot" });
  session.prepareModelSet({ config: {}, routing });
  expect(session.billing.authorizationDecisionId).toBe("auth");
  expect(host.task.ensureChatTurnTaskOutcome).not.toHaveBeenCalled();
  await session.authorize({ agentId: "bot" });
  expect(host.admission.tryAcquireEnterpriseAgentRun).toHaveBeenCalledOnce();
  session.dispose();
  session.dispose();
  expect(host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
  expect(host.model.forgetRunModelSet).toHaveBeenCalledOnce();
  expect(() => session.prepareModelSet({ config: {}, routing })).toThrow(/authorized/);
  await expect(session.authorize({})).rejects.toThrow(/disposed/);
});
it("denial never prepares candidates or releases an unheld slot", async () => {
  const { host, session, routing } = setup();
  vi.mocked(host.admission.tryAcquireEnterpriseAgentRun).mockResolvedValue({
    acquired: false,
    skipped: false,
    reason: "NO_SUBSCRIPTION",
    message: "denied",
  });
  expect((await session.authorize({})).acquired).toBe(false);
  expect(() => session.prepareModelSet({ config: {}, routing })).toThrow(/authorized/);
  session.dispose();
  expect(host.model.buildRunModelSetSnapshot).not.toHaveBeenCalled();
  expect(host.admission.releaseEnterpriseAgentRun).not.toHaveBeenCalled();
});
it("preserves skipped admission retry and does not invent billing", async () => {
  const { host, session, routing } = setup();
  vi.mocked(host.admission.tryAcquireEnterpriseAgentRun).mockResolvedValueOnce({
    acquired: false,
    skipped: true,
  });
  await session.authorize({});
  expect(session.held).toBe(false);
  expect(session.billing.subscriptionId).toBeUndefined();
  session.prepareModelSet({ config: {}, routing });
  await session.authorize({});
  expect(session.held).toBe(true);
  expect(host.admission.tryAcquireEnterpriseAgentRun).toHaveBeenCalledTimes(2);
  session.dispose();
});
