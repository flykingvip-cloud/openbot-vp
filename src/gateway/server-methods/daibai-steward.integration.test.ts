import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureBuiltinStewardAgent } from "../../agents/builtin-steward/provision.js";
import { daibaiHandlers } from "./daibai.js";

let stateDir: string;
let envSnapshot: string | undefined;

beforeEach(async () => {
  envSnapshot = process.env.OPENCLAW_STATE_DIR;
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-daibai-e2e-"));
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(async () => {
  if (envSnapshot === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = envSnapshot;
  }
  await new Promise((r) => setTimeout(r, 50));
  await fs.rm(stateDir, { recursive: true, force: true });
});

describe("daibai steward e2e", () => {
  it("covers provision → ask chip hints → pending confirmation (D2)", async () => {
    const provisioned = ensureBuiltinStewardAgent({});
    expect(provisioned.agents?.list?.some((entry) => entry.id === "main")).toBe(true);

    const askRespond = vi.fn();
    await daibaiHandlers["user.daibai.ask"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        sessionKey: "main",
        message: "我遇到一个 bug，需要平台支持",
      },
      respond: askRespond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const askResult = askRespond.mock.calls.at(-1)?.[1] as {
      summary?: string;
      guide?: { headline: string };
      route?: { tier: string };
      suggestedActions?: Array<{
        actionId: string;
        payload?: { userProblem?: string; contextBundle?: { userMessage: string } };
      }>;
    };
    expect(askResult.summary).toBe("");
    expect(askResult.guide).toBeUndefined();
    expect(askResult.route).toBeUndefined();
    const escalateChip = askResult.suggestedActions?.find(
      (entry) => entry.actionId === "support.case.create",
    );
    expect(escalateChip).toBeTruthy();
    const userProblem =
      escalateChip?.payload?.userProblem ?? escalateChip?.payload?.contextBundle?.userMessage;
    expect(userProblem).toContain("bug");

    const executeRespond = vi.fn();
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "user-1",
        actionId: "robot-skills.toggle",
        payload: { agentId: "main", skillId: "s1", enabled: true },
      },
      respond: executeRespond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const executeResult = executeRespond.mock.calls.at(-1)?.[1] as {
      status: string;
      confirmation?: { proposalId: string };
    };
    expect(executeResult.status).toBe("pending_confirmation");
    expect(executeResult.confirmation?.proposalId).toMatch(/^dbc_/);
  });

  it("covers ask metadata + memory write-back + support escalation + confirmation consume (D2)", async () => {
    const { loadStewardMemory } = await import("../../support-cases/steward-memory-store.js");
    ensureBuiltinStewardAgent({});

    // 1) billing question → chip-hints API stays metadata-only (conversation goes through chat.send).
    const askA = vi.fn();
    await daibaiHandlers["user.daibai.ask"]({
      req: {} as never,
      params: {
        userId: "u1",
        tenantId: "t1",
        sessionKey: "main",
        message: "我这个月还剩多少额度",
      },
      respond: askA as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const askAResult = askA.mock.calls.at(-1)?.[1] as {
      summary?: string;
      guide?: unknown;
      route?: unknown;
      suggestedActions?: Array<{ actionId: string }>;
    };
    expect(askAResult.summary).toBe("");
    expect(askAResult.guide).toBeUndefined();
    expect(askAResult.route).toBeUndefined();
    expect(askAResult.suggestedActions ?? []).toEqual([]);

    // memory write-back is fire-and-forget; allow it to settle.
    await new Promise((r) => setTimeout(r, 50));
    const memory = await loadStewardMemory({ userId: "u1", tenantId: "t1" });
    expect(memory.lastIntents.length).toBeGreaterThan(0);

    // 2) escalate → create support case (closing the loop to platform).
    const createRespond = vi.fn();
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "u1",
        tenantId: "t1",
        sessionKey: "main",
        actionId: "support.case.create",
        payload: { userProblem: "需要平台协助处理一个问题" },
      },
      respond: createRespond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const created = createRespond.mock.calls.at(-1)?.[1] as { status: string; caseId?: string };
    expect(created.status).toBe("executed");
    expect(created.caseId).toMatch(/^sc_/);

    // 3) re-ask shows the open support case (memory + support state integrated).
    const askB = vi.fn();
    await daibaiHandlers["user.daibai.ask"]({
      req: {} as never,
      params: { userId: "u1", tenantId: "t1", sessionKey: "main", message: "继续跟进" },
      respond: askB as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const askBResult = askB.mock.calls.at(-1)?.[1] as {
      supportContext?: { openCaseCount: number };
    };
    expect(askBResult.supportContext?.openCaseCount).toBeGreaterThanOrEqual(1);

    // 4) confirmation flow: first call issues a ticket; second call consumes it and
    //    passes the gate into delegation (proves consume succeeded, not a confirmation block).
    const firstRespond = vi.fn();
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "u1",
        actionId: "robot-skills.toggle",
        payload: { agentId: "main", skillId: "s1", enabled: true },
      },
      respond: firstRespond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const pending = firstRespond.mock.calls.at(-1)?.[1] as {
      status: string;
      confirmation?: { proposalId: string; confirmationToken: string };
    };
    expect(pending.status).toBe("pending_confirmation");

    const secondRespond = vi.fn();
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "u1",
        actionId: "robot-skills.toggle",
        payload: { agentId: "main", skillId: "s1", enabled: true },
        proposalId: pending.confirmation?.proposalId,
        confirmationToken: pending.confirmation?.confirmationToken,
      },
      respond: secondRespond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    // No skill "s1" is seeded, so delegation fails with ok=false — which proves the
    // confirmation ticket was consumed and the gate was passed (not pending / not confirmation-blocked).
    const [secondOk, , secondError] = secondRespond.mock.calls.at(-1) ?? [];
    expect(secondOk).toBe(false);
    expect(secondError).toBeTruthy();

    // The single-consume ticket must now be invalid (replay rejected).
    const replayRespond = vi.fn();
    await daibaiHandlers["user.daibai.execute"]({
      req: {} as never,
      params: {
        userId: "u1",
        actionId: "robot-skills.toggle",
        payload: { agentId: "main", skillId: "s1", enabled: true },
        proposalId: pending.confirmation?.proposalId,
        confirmationToken: pending.confirmation?.confirmationToken,
      },
      respond: replayRespond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    const replay = replayRespond.mock.calls.at(-1)?.[1] as { status?: string; message?: string };
    // The single-consume ticket was already used, so replay is rejected as blocked (not re-executed).
    expect(replay.status).toBe("blocked");
  });
});
