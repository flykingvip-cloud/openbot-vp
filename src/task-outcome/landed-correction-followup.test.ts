import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diagnosisTaskOutcomeRows } from "../../ui/src/ui/ports/enterprise/diagnosis/diagnosis-task-outcome-rows.ts";
import type { OpenBotConfig } from "../config/config.js";
import {
  formatTaskOutcomeEvidenceText,
  readTaskOutcomeEvidence,
} from "../diagnosis/task-outcome-evidence.js";
import { createTaskOutcomeRejectHandlers } from "../gateway/server-methods/task-outcome-reject.js";
import {
  createCorrectionNoticeSessionInject,
  type CorrectionNoticeInjectInput,
} from "./correction-notice-inject.js";
import {
  resolveCorrectionNoticeRecipient,
  resolveCorrectionNoticeSessionKey,
} from "./correction-notice-session.js";
import { CORRECTION_NOTIFY_ENABLED, correctionNotifyText } from "./correction-notify.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import {
  orchestrateLandedCorrection,
  type LandedCorrectionFollowUp,
} from "./landed-correction-followup.js";
import { RECHECK_EXECUTION_ENABLED, type RecheckRun } from "./recheck-executor.js";
import { formatRecheckObservationLabel } from "./recheck-label.js";
import { readRecheckObservation, recheckObservationFilePath } from "./recheck-observation.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { replayStoredScenario } from "./scenario-recheck-run.js";
import { boundedOutcomePathSegment, DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const aliceScope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:subject-alice",
  subjectRef: "subject:alice",
  authzScopeRef: "scope:test",
};

function tempAgent(): { cfg: OpenBotConfig; agentDir: string; root: string } {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "followup-wire-"));
  dirs.push(agentDir);
  const cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
  return { cfg, agentDir, root: path.join(agentDir, "task-outcomes") };
}

function closeOwned(
  store: DurableTaskOutcomeStore,
  taskId: string,
  scope: TrustedScope,
  withRun: boolean,
) {
  const service = new TaskOutcomeResultService({ store, submittedBy: "test" });
  const chat = new ChatTaskOutcomeAdapter(service);
  const opened = chat.createOrRestore({
    taskId,
    scope,
    taskContractVersion: "1.0.0",
    commandId: `create:${taskId}`,
  });
  if (!opened.ok) {
    throw new Error(opened.message);
  }
  let version = opened.record.outcomeVersion;
  const fencing = opened.fencingToken;
  if (withRun) {
    const attempt = chat.recordAttempt(
      taskId,
      version,
      fencing,
      {
        attemptId: "a1",
        runId: "r1",
        status: "succeeded",
        observedAt: "2026-11-01T00:00:00.000Z",
        toolObservations: [{ toolName: "turn_tools", ok: false, summary: "0/1" }],
      },
      { runId: "r1", attemptIds: ["a1"], fencingToken: fencing, status: "succeeded" },
      { scope, commandId: `attempt:${taskId}` },
    );
    if (!attempt.ok) {
      throw new Error(attempt.message);
    }
    version = attempt.record.outcomeVersion;
  }
  const accepted = chat.setAcceptance(
    taskId,
    version,
    fencing,
    { status: "not_required", reason: "chat_turn_contract_v1:no_external_acceptance" },
    { allowRetry: true, scope, commandId: `accept:${taskId}` },
  );
  if (!accepted.ok) {
    throw new Error(accepted.message);
  }
  const delivered = chat.setDelivery(
    taskId,
    accepted.record.outcomeVersion,
    fencing,
    { status: "delivered" },
    "delivery-1",
    { scope, commandId: `delivery:${taskId}` },
  );
  if (!delivered.ok) {
    throw new Error(delivered.message);
  }
  return delivered.record;
}

type RejectBody = {
  ok?: boolean;
  code?: string;
  replayed?: boolean;
  record?: { outcomeVersion?: number; taskJudgement?: string; revisionKind?: string };
};

async function callReject(input: {
  cfg: OpenBotConfig;
  userId: string;
  taskId: string;
  outcomeVersion: number;
  tenantId?: string | null;
  followUp?: {
    notifyEnabled?: boolean;
    recheckEnabled?: boolean;
    inject?: (request: CorrectionNoticeInjectInput) => Promise<unknown>;
    run?: RecheckRun;
    observe?: (report: LandedCorrectionFollowUp) => void;
  };
  extra?: Record<string, unknown>;
}): Promise<{ transportOk: boolean; body: RejectBody | undefined }> {
  const handlers = createTaskOutcomeRejectHandlers({
    cfg: input.cfg,
    resolveCaller: async (client) => ({
      subjectRaw: client?.platformUserId?.trim() || "",
      tenantId: input.tenantId ?? null,
    }),
    followUp: input.followUp,
  });
  let transportOk = false;
  let body: RejectBody | undefined;
  await handlers["task.outcome.rejectResult"]({
    req: { type: "req", id: "r", method: "task.outcome.rejectResult" } as never,
    params: {
      taskId: input.taskId,
      agentId: "bot",
      outcomeVersion: input.outcomeVersion,
      ...input.extra,
    },
    client: { platformUserId: input.userId } as never,
    isWebchatConnect: () => false,
    respond: (ok, payload) => {
      transportOk = ok;
      body = payload as RejectBody;
    },
    context: {} as never,
  });
  return { transportOk, body };
}

describe("landed correction follow-up wiring", () => {
  it("keeps both switches off", () => {
    expect(RECHECK_EXECUTION_ENABLED).toBe(false);
    expect(CORRECTION_NOTIFY_ENABLED).toBe(false);
  });

  it("resolves only the stored subject and refuses forbidden or guessed sessions", async () => {
    expect(resolveCorrectionNoticeSessionKey("agent:main:main")).toBeNull();
    expect(resolveCorrectionNoticeSessionKey("diagnosis:canary:daibai")).toBeNull();
    expect(resolveCorrectionNoticeSessionKey("subject:alice")).toBe(
      "agent:main:employee:subject-alice",
    );
    expect(
      resolveCorrectionNoticeRecipient({
        scope: aliceScope,
        authenticatedPlatformUserId: "alice",
      }),
    ).toMatchObject({
      ok: true,
      platformUserId: "subject:alice",
      sessionKey: "agent:main:employee:subject-alice",
    });
    expect(
      resolveCorrectionNoticeRecipient({
        scope: aliceScope,
        authenticatedPlatformUserId: "platform-user:alice",
      }),
    ).toEqual({ ok: false, code: "recipient_unresolved" });
    expect(
      resolveCorrectionNoticeRecipient({
        scope: aliceScope,
        authenticatedPlatformUserId: "mallory",
      }),
    ).toEqual({ ok: false, code: "recipient_unresolved" });

    const injected: string[] = [];
    const send = createCorrectionNoticeSessionInject({
      inject: async (request) => {
        injected.push(request.params.sessionKey);
        return { ok: true };
      },
    });
    await expect(send({ platformUserId: "agent:main:main", text: "nope" })).rejects.toThrow(
      /forbidden/,
    );
    await expect(send({ platformUserId: "diagnosis:canary:daibai", text: "nope" })).rejects.toThrow(
      /forbidden/,
    );
    expect(injected).toEqual([]);
  });

  it("does not treat a bare success or a missing run as a completed replay", () => {
    const scenario = {
      taskId: "task-1",
      outcomeVersion: 2,
      taskContractVersion: "1.0.0",
      scenarioId: "r1",
    };
    const missing = replayStoredScenario(scenario, {
      taskId: "task-1",
      outcomeVersion: 2,
      taskContractVersion: "1.0.0",
      decisiveRunId: "r1",
      runs: [],
    });
    expect(missing).toEqual({ ok: false, reason: "failed" });
    expect(missing).not.toEqual({ ok: true });
    const proved = replayStoredScenario(scenario, {
      taskId: "task-1",
      outcomeVersion: 2,
      taskContractVersion: "1.0.0",
      decisiveRunId: "r1",
      runs: [{ runId: "r1", attemptIds: ["a1"], fencingToken: "fence", status: "succeeded" }],
    });
    expect(proved).toEqual({ ok: true, ...scenario });
    expect(
      replayStoredScenario(
        { ...scenario, scenarioId: "other" },
        {
          taskId: "task-1",
          outcomeVersion: 2,
          taskContractVersion: "1.0.0",
          decisiveRunId: "r1",
          runs: [{ runId: "r1", attemptIds: ["a1"], fencingToken: "fence", status: "succeeded" }],
        },
      ),
    ).toEqual({ ok: false, reason: "failed" });
  });

  it("calls follow-up after a fresh reject and writes nothing while the switches stay off", async () => {
    const { cfg, root } = tempAgent();
    const store = new DurableTaskOutcomeStore(root);
    const closed = closeOwned(store, "task-off", aliceScope, true);
    expect(closed.taskJudgement).toBe("success");
    store.close();
    const seen: LandedCorrectionFollowUp[] = [];
    const injected: CorrectionNoticeInjectInput[] = [];
    const result = await callReject({
      cfg,
      userId: "alice",
      taskId: "task-off",
      outcomeVersion: closed.outcomeVersion,
      followUp: {
        inject: async (request) => {
          injected.push(request);
          return { ok: true };
        },
        observe: (report) => {
          seen.push(report);
        },
      },
    });
    expect(result.transportOk).toBe(true);
    expect(result.body?.ok).toBe(true);
    expect(result.body?.record?.taskJudgement).toBe("failure");
    expect(result.body?.record?.revisionKind).toBe("correction");
    expect(JSON.stringify(result.body)).not.toContain("已读");
    expect(seen).toEqual([
      {
        notify: { ok: false, code: "not_enabled" },
        recheck: { ok: false, code: "not_enabled" },
      },
    ]);
    expect(injected).toEqual([]);
    expect(fs.existsSync(path.join(root, "correction-notify"))).toBe(false);
    expect(fs.existsSync(path.join(root, "recheck-observations"))).toBe(false);
    const after = new DurableTaskOutcomeStore(root);
    expect(after.loadTaskVersion("task-off", closed.outcomeVersion)?.taskJudgement).toBe("success");
    expect(after.loadTask("task-off")?.taskJudgement).toBe("failure");
    after.close();
  });

  it("uses the session inject and stored-run replay when the test switches are on", async () => {
    const { cfg, root } = tempAgent();
    const store = new DurableTaskOutcomeStore(root);
    const closed = closeOwned(store, "task-on", aliceScope, true);
    store.close();
    const injected: CorrectionNoticeInjectInput[] = [];
    const seen: LandedCorrectionFollowUp[] = [];
    const result = await callReject({
      cfg,
      userId: "alice",
      taskId: "task-on",
      outcomeVersion: closed.outcomeVersion,
      followUp: {
        notifyEnabled: true,
        recheckEnabled: true,
        inject: async (request) => {
          injected.push(request);
          return { ok: true };
        },
        observe: (report) => {
          seen.push(report);
        },
      },
    });
    expect(result.body?.ok).toBe(true);
    expect(result.body?.replayed).toBe(false);
    expect(result.body?.record?.taskJudgement).toBe("failure");
    expect(seen[0]?.notify).toMatchObject({
      ok: true,
      accepted: true,
      read: false,
      replayed: false,
    });
    expect(seen[0]?.recheck).toMatchObject({ ok: true, status: "completed", attempt: 1 });
    expect(injected).toHaveLength(1);
    const notice = injected[0];
    expect(notice?.method).toBe("chat.inject");
    expect(notice?.params.sessionKey).toBe("agent:main:employee:subject-alice");
    expect(notice?.params.label).toBe("纠正记录");
    const correctionVersion = result.body?.record?.outcomeVersion ?? 0;
    expect(notice?.params.message).toBe(
      correctionNotifyText({
        taskId: "task-on",
        negatedOutcomeVersion: closed.outcomeVersion,
        correctionOutcomeVersion: correctionVersion,
        judgement: "failure",
      }),
    );
    expect(notice?.params.message).not.toContain("用户已读");
    expect(notice?.params.message).not.toContain("复验已通过");
    const receiptPath = path.join(
      root,
      "correction-notify",
      `${boundedOutcomePathSegment("bot")}.json`,
    );
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as {
      receipts: Array<{ platformUserId: string; outcomeVersion: number }>;
    };
    expect(receipt.receipts).toEqual([
      expect.objectContaining({
        platformUserId: "subject:alice",
        taskId: "task-on",
        outcomeVersion: correctionVersion,
      }),
    ]);
    expect(readRecheckObservation(root, "task-on", correctionVersion)).toMatchObject({
      ok: true,
      status: "completed",
      attempt: 1,
    });
    const evidence = readTaskOutcomeEvidence({
      cfg,
      agentId: "bot",
      taskId: "task-on",
      outcomeVersion: correctionVersion,
      callerSubjectRaw: "alice",
    });
    expect(evidence).toMatchObject({
      ok: true,
      judgement: "failure",
      recheckStatus: "completed",
      recheckAttempt: 1,
    });
    expect(formatTaskOutcomeEvidenceText(evidence)).toContain("第1次复验已记录");
    expect(formatRecheckObservationLabel("read_failed")).toBe("复验记录读取失败");
    const rows = diagnosisTaskOutcomeRows({ evidence, sourceLabel: "手填" });
    expect(rows.find((row) => row.label === "复验结果")?.value).toBe("第1次复验已记录");
    const after = new DurableTaskOutcomeStore(root);
    expect(after.loadTaskVersion("task-on", closed.outcomeVersion)?.taskJudgement).toBe("success");
    expect(after.loadTask("task-on")?.taskJudgement).toBe("failure");
    expect(after.loadTask("task-on")?.outcomeVersion).toBe(correctionVersion);
    after.close();

    const again = await callReject({
      cfg,
      userId: "alice",
      taskId: "task-on",
      outcomeVersion: correctionVersion,
      followUp: {
        notifyEnabled: true,
        recheckEnabled: true,
        inject: async (request) => {
          injected.push(request);
          return { ok: true };
        },
        observe: (report) => {
          seen.push(report);
        },
      },
    });
    expect(again.body).toMatchObject({ ok: true, replayed: true });
    expect(injected).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(readRecheckObservation(root, "task-on", correctionVersion)).toMatchObject({
      attempt: 1,
    });
  });

  it("dedups a second notice for the same correction version", async () => {
    const { cfg, root } = tempAgent();
    const store = new DurableTaskOutcomeStore(root);
    const closed = closeOwned(store, "task-dedup", aliceScope, true);
    store.close();
    const injected: string[] = [];
    const first = await callReject({
      cfg,
      userId: "alice",
      taskId: "task-dedup",
      outcomeVersion: closed.outcomeVersion,
      followUp: {
        notifyEnabled: true,
        recheckEnabled: false,
        inject: async (request) => {
          injected.push(request.params.sessionKey);
          return { ok: true };
        },
      },
    });
    const record = new DurableTaskOutcomeStore(root).loadTask("task-dedup");
    expect(record?.revisionKind).toBe("correction");
    if (!record) {
      throw new Error("missing correction");
    }
    const second = await orchestrateLandedCorrection({
      cfg,
      agentId: "bot",
      record,
      authenticatedPlatformUserId: "alice",
      notifyEnabled: true,
      recheckEnabled: false,
      inject: async () => {
        injected.push("again");
        return { ok: true };
      },
    });
    expect(second.notify).toMatchObject({ ok: true, replayed: true, accepted: true, read: false });
    expect(injected).toEqual(["agent:main:employee:subject-alice"]);
    expect(first.body?.record?.taskJudgement).toBe("failure");
    expect(new DurableTaskOutcomeStore(root).loadTask("task-dedup")?.taskJudgement).toBe("failure");
  });

  it("fails closed for a stranger, a forbidden subject, and a missing scenario without failing the correction", async () => {
    const { cfg, root } = tempAgent();
    const store = new DurableTaskOutcomeStore(root);
    const closed = closeOwned(store, "task-guard", aliceScope, true);
    const noRun = closeOwned(store, "task-norun", aliceScope, false);
    const forbiddenScope: TrustedScope = {
      kind: "personal",
      personalDomainId: "personal:agent-main",
      subjectRef: "agent:main:main",
      authzScopeRef: "scope:test",
    };
    const forbidden = closeOwned(store, "task-forbidden", forbiddenScope, true);
    store.close();
    const injected: string[] = [];
    const inject = async () => {
      injected.push("sent");
      return { ok: true };
    };
    const stranger = await callReject({
      cfg,
      userId: "mallory",
      taskId: "task-guard",
      outcomeVersion: closed.outcomeVersion,
      extra: { mappingVerified: true, verifiedPlatformUserId: "subject:alice" },
      followUp: {
        notifyEnabled: true,
        recheckEnabled: true,
        inject,
        observe: () => injected.push("ran"),
      },
    });
    expect(stranger.body).toMatchObject({ ok: false, code: "unauthorized" });
    expect(injected).toEqual([]);

    const blocked = await callReject({
      cfg,
      userId: "agent:main:main",
      taskId: "task-forbidden",
      outcomeVersion: forbidden.outcomeVersion,
      followUp: { notifyEnabled: true, recheckEnabled: true, inject },
    });
    expect(blocked.body?.ok).toBe(true);
    expect(blocked.body?.record?.taskJudgement).toBe("failure");
    expect(injected).toEqual([]);
    expect(fs.existsSync(path.join(root, "correction-notify"))).toBe(false);

    const unbound = await callReject({
      cfg,
      userId: "alice",
      taskId: "task-norun",
      outcomeVersion: noRun.outcomeVersion,
      followUp: {
        notifyEnabled: false,
        recheckEnabled: true,
        inject,
        observe: (report) => {
          expect(report.recheck).toEqual({ ok: false, code: "scenario_missing" });
          expect(report.notify).toEqual({ ok: false, code: "not_enabled" });
        },
      },
    });
    expect(unbound.body?.ok).toBe(true);
    expect(unbound.body?.record?.taskJudgement).toBe("failure");
    expect(fs.existsSync(recheckObservationFilePath(root, "task-norun"))).toBe(false);
    const after = new DurableTaskOutcomeStore(root);
    expect(after.loadTask("task-forbidden")?.taskJudgement).toBe("failure");
    expect(after.loadTaskVersion("task-guard", closed.outcomeVersion)?.taskJudgement).toBe(
      "success",
    );
    after.close();
  });

  it("does not record a bare runner success as a completed recheck", async () => {
    const { cfg, root } = tempAgent();
    const store = new DurableTaskOutcomeStore(root);
    const closed = closeOwned(store, "task-bare", aliceScope, true);
    store.close();
    const result = await callReject({
      cfg,
      userId: "alice",
      taskId: "task-bare",
      outcomeVersion: closed.outcomeVersion,
      followUp: {
        notifyEnabled: false,
        recheckEnabled: true,
        run: () => ({ ok: true }) as ReturnType<RecheckRun>,
        observe: (report) => {
          expect(report.recheck).toEqual({ ok: false, code: "binding_mismatch" });
        },
      },
    });
    expect(result.body?.ok).toBe(true);
    expect(result.body?.record?.taskJudgement).toBe("failure");
    expect(fs.existsSync(recheckObservationFilePath(root, "task-bare"))).toBe(false);
    expect(new DurableTaskOutcomeStore(root).loadTask("task-bare")?.outcomeVersion).toBe(
      closed.outcomeVersion + 1,
    );
  });

  it("keeps the reject result when notice or recheck fails", async () => {
    const { cfg, root } = tempAgent();
    const store = new DurableTaskOutcomeStore(root);
    const closed = closeOwned(store, "task-fail", aliceScope, true);
    store.close();
    const noticed = await callReject({
      cfg,
      userId: "alice",
      taskId: "task-fail",
      outcomeVersion: closed.outcomeVersion,
      followUp: {
        notifyEnabled: true,
        recheckEnabled: true,
        inject: async () => {
          throw new Error("gateway down");
        },
        run: () => ({ ok: false, reason: "tool_failure" }),
      },
    });
    expect(noticed.transportOk).toBe(true);
    expect(noticed.body?.ok).toBe(true);
    expect(noticed.body?.record?.taskJudgement).toBe("failure");
    expect(
      fs.existsSync(
        path.join(root, "correction-notify", `${boundedOutcomePathSegment("bot")}.json`),
      ),
    ).toBe(false);
    const version = noticed.body?.record?.outcomeVersion ?? 0;
    expect(readRecheckObservation(root, "task-fail", version)).toMatchObject({
      ok: true,
      status: "incomplete",
      attempt: 1,
    });
    const after = new DurableTaskOutcomeStore(root);
    expect(after.loadTaskVersion("task-fail", closed.outcomeVersion)?.taskJudgement).toBe(
      "success",
    );
    expect(after.loadTask("task-fail")?.taskJudgement).toBe("failure");
    expect(after.loadTask("task-fail")?.outcomeVersion).toBe(version);
    after.close();

    const observed = new DurableTaskOutcomeStore(root);
    const other = closeOwned(observed, "task-observe", aliceScope, true);
    observed.close();
    const thrown = await callReject({
      cfg,
      userId: "alice",
      taskId: "task-observe",
      outcomeVersion: other.outcomeVersion,
      followUp: {
        notifyEnabled: true,
        recheckEnabled: true,
        observe: () => {
          throw new Error("observer failed");
        },
      },
    });
    expect(thrown.body?.ok).toBe(true);
    expect(thrown.body?.record?.taskJudgement).toBe("failure");
    expect(thrown.body?.record?.outcomeVersion).toBe(other.outcomeVersion + 1);
    expect(new DurableTaskOutcomeStore(root).loadTask("task-fail")?.outcomeVersion).toBe(version);
  });
});
