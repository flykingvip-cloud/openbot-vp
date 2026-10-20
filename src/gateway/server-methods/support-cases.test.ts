import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supportCasesHandlers } from "./support-cases.js";

let stateDir: string;
let envSnapshot: string | undefined;

beforeEach(async () => {
  envSnapshot = process.env.OPENCLAW_STATE_DIR;
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-support-cases-"));
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(async () => {
  if (envSnapshot === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = envSnapshot;
  }
  await fs.rm(stateDir, { recursive: true, force: true });
});

describe("support.cases handlers", () => {
  it("creates, lists, resolves, gets, and closes support cases", async () => {
    const respond = vi.fn();

    await supportCasesHandlers["support.cases.create"]({
      req: {} as never,
      params: {
        userId: "user-1",
        tenantId: "tenant-1",
        category: "unknown",
        userProblem: "我需要创建新的 skill",
        contextBundle: {
          userMessage: "我需要创建新的 skill",
          sourceSessionKey: "main",
        },
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });

    const created = respond.mock.calls.at(-1)?.[1] as { caseId: string };
    expect(created.caseId).toMatch(/^sc_/);

    await supportCasesHandlers["support.cases.list"]({
      req: {} as never,
      params: { userId: "user-1" },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    expect(respond.mock.calls.at(-1)?.[1]).toMatchObject({
      cases: [expect.objectContaining({ caseId: created.caseId, userId: "user-1" })],
    });

    await supportCasesHandlers["support.cases.resolve"]({
      req: {} as never,
      params: {
        caseId: created.caseId,
        platformAssignee: "ops-1",
        proposal: {
          proposalVersion: 1,
          userFacingReply: "请先确认 skill 的目标输入输出。",
          requiresUserConfirmation: true,
          updatedAtMs: Date.now(),
        },
      },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    expect(respond.mock.calls.at(-1)?.[1]).toMatchObject({
      caseId: created.caseId,
      status: "resolved",
      currentProposalVersion: 1,
    });

    await supportCasesHandlers["support.cases.get"]({
      req: {} as never,
      params: { caseId: created.caseId },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    expect(respond.mock.calls.at(-1)?.[1]).toMatchObject({
      caseId: created.caseId,
      resolutionProposal: expect.objectContaining({ proposalVersion: 1 }),
    });

    await supportCasesHandlers["support.cases.close"]({
      req: {} as never,
      params: { caseId: created.caseId },
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    expect(respond.mock.calls.at(-1)?.[1]).toMatchObject({
      caseId: created.caseId,
      status: "closed",
    });
  });
});
