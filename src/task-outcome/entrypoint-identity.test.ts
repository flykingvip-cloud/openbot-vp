import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { ensureChatTurnTaskOutcome } from "./chat-entry.js";
import {
  ensureCliTurnTaskOutcome,
  ensureCollabTurnTaskOutcome,
  ensureCronTurnTaskOutcome,
  ensureFollowupTurnTaskOutcome,
  ensureGatewayAgentTurnTaskOutcome,
} from "./entrypoint-ensure.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { CronTaskOutcomeAdapter } from "./entrypoints/cron.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { recordRunnerTurnOutcome, TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { Entrypoint, TrustedScope } from "./types.js";

function personalScope(subject = "subject:tester"): TrustedScope {
  return {
    kind: "personal",
    personalDomainId: `personal:${subject}`,
    subjectRef: subject,
    authzScopeRef: "test",
  };
}

describe("askOutcome W1 entrypoint identity", () => {
  let agentDir = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "w1-entry-"));
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  function store(): DurableTaskOutcomeStore {
    return new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
  }

  it("chat ensure persists entrypoint=chat", () => {
    const opened = ensureChatTurnTaskOutcome(cfg, {
      agentId: "bot",
      runId: "r1",
      sessionKey: "s1",
      subjectRef: "platform-user:u1",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    expect(opened.record.entrypoint).toBe("chat");
    expect(store().loadTask(opened.taskId)?.entrypoint).toBe("chat");
  });

  it("cron ensure + recordRunnerTurnOutcome persist entrypoint=cron", async () => {
    const opened = ensureCronTurnTaskOutcome(cfg, {
      agentId: "bot",
      jobId: "job-1",
      fireId: "fire-9",
      subjectRef: "subject:owner",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    expect(opened.record.entrypoint).toBe("cron");
    expect(opened.entrypoint).toBe("cron");

    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "cron-run-1",
      taskId: opened.taskId,
      scope: opened.scope,
      entrypoint: "cron",
    });
    expect(out.record.entrypoint).toBe("cron");
    expect(store().loadTask(opened.taskId)?.entrypoint).toBe("cron");
  });

  it("cron same fire reuses taskId; different fire is independent", () => {
    const a = ensureCronTurnTaskOutcome(cfg, {
      agentId: "bot",
      jobId: "job-1",
      fireId: "fire-9",
      subjectRef: "subject:owner",
    });
    const b = ensureCronTurnTaskOutcome(cfg, {
      agentId: "bot",
      jobId: "job-1",
      fireId: "fire-9",
      subjectRef: "subject:owner",
    });
    const c = ensureCronTurnTaskOutcome(cfg, {
      agentId: "bot",
      jobId: "job-1",
      fireId: "fire-10",
      subjectRef: "subject:owner",
    });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!(a.ok && b.ok && c.ok)) {
      return;
    }
    expect(a.taskId).toBe(b.taskId);
    expect(a.record.entrypoint).toBe("cron");
    expect(c.taskId).not.toBe(a.taskId);
    expect(c.record.entrypoint).toBe("cron");
  });

  it("cli / collab / gateway_agent ensure persist declared entrypoint", () => {
    const cases: Array<{
      entrypoint: Entrypoint;
      open: () => ReturnType<typeof ensureCliTurnTaskOutcome>;
    }> = [
      {
        entrypoint: "cli",
        open: () =>
          ensureCliTurnTaskOutcome(cfg, {
            agentId: "bot",
            runId: "cli-run-1",
            subjectRef: "subject:cli",
          }),
      },
      {
        entrypoint: "collab",
        open: () =>
          ensureCollabTurnTaskOutcome(cfg, {
            agentId: "bot",
            groupId: "g1",
            boardItemId: "item-1",
            claimId: "claim-1",
            subjectRef: "subject:collab",
          }),
      },
      {
        entrypoint: "gateway_agent",
        open: () =>
          ensureGatewayAgentTurnTaskOutcome(cfg, {
            agentId: "bot",
            runId: "gw-run-1",
            subjectRef: "subject:gw",
          }),
      },
    ];
    for (const row of cases) {
      const opened = row.open();
      expect(opened.ok, row.entrypoint).toBe(true);
      if (!opened.ok) {
        continue;
      }
      expect(opened.record.entrypoint).toBe(row.entrypoint);
      expect(opened.entrypoint).toBe(row.entrypoint);
      expect(store().loadTask(opened.taskId)?.entrypoint).toBe(row.entrypoint);
    }
  });

  it("followup ensure persists chat entrypoint with followup taskId", () => {
    const opened = ensureFollowupTurnTaskOutcome(cfg, {
      agentId: "bot",
      runId: "fu-1",
      sessionKey: "sess-fu",
      subjectRef: "platform-user:u1",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    expect(opened.taskId).toContain(":followup:");
    expect(opened.record.entrypoint).toBe("chat");
  });

  it("success / failure / cancel / recover / duplicate across cron adapter", async () => {
    const opened = ensureCronTurnTaskOutcome(cfg, {
      agentId: "bot",
      jobId: "job-x",
      fireId: "fire-a",
      subjectRef: "subject:owner",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }

    // success (incomplete without gates)
    const ok = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-ok",
      taskId: opened.taskId,
      scope: opened.scope,
      entrypoint: "cron",
    });
    expect(ok.record.entrypoint).toBe("cron");
    expect(ok.record.taskJudgement).toBe("incomplete");

    // failure on a fresh fire
    const failOpen = ensureCronTurnTaskOutcome(cfg, {
      agentId: "bot",
      jobId: "job-x",
      fireId: "fire-fail",
      subjectRef: "subject:owner",
    });
    expect(failOpen.ok).toBe(true);
    if (!failOpen.ok) {
      return;
    }
    const fail = await recordRunnerTurnOutcome(cfg, "bot", {
      success: false,
      runId: "run-fail",
      taskId: failOpen.taskId,
      scope: failOpen.scope,
      entrypoint: "cron",
      failureReason: "run_failed",
    });
    expect(fail.record.entrypoint).toBe("cron");
    expect(fail.record.lifecycle).toBe("closed");
    expect(fail.record.taskJudgement).toBe("failure");

    // cancel
    const cancelOpen = ensureCronTurnTaskOutcome(cfg, {
      agentId: "bot",
      jobId: "job-x",
      fireId: "fire-cancel",
      subjectRef: "subject:owner",
    });
    expect(cancelOpen.ok).toBe(true);
    if (!cancelOpen.ok) {
      return;
    }
    const service = new TaskOutcomeResultService({
      store: store(),
      submittedBy: "w1-test",
    });
    const cron = new CronTaskOutcomeAdapter(service);
    const cancelled = cron.cancel(
      cancelOpen.taskId,
      cancelOpen.record.outcomeVersion,
      cancelOpen.fencingToken,
      { scope: cancelOpen.scope },
    );
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) {
      expect(cancelled.record.entrypoint).toBe("cron");
      expect(cancelled.record.taskJudgement).toBe("cancelled");
    }

    // recover / restore same fire (duplicate open)
    const recovered = ensureCronTurnTaskOutcome(cfg, {
      agentId: "bot",
      jobId: "job-x",
      fireId: "fire-a",
      subjectRef: "subject:owner",
    });
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(recovered.taskId).toBe(opened.taskId);
      expect(recovered.record.entrypoint).toBe("cron");
      expect(recovered.record.outcomeVersion).toBeGreaterThanOrEqual(opened.record.outcomeVersion);
    }

    // duplicate command create is restore, not a second tip with chat entrypoint
    const again = cron.openTask({
      taskId: opened.taskId,
      scope: opened.scope,
      taskContractVersion: "1.0.0",
    });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.record.entrypoint).toBe("cron");
    }
  });

  it("subclasses no longer silently write chat via createOrRestore", () => {
    const service = new TaskOutcomeResultService({
      store: store(),
      submittedBy: "w1-test",
    });
    const cron = new CronTaskOutcomeAdapter(service);
    const opened = cron.openTask({
      taskId: "cron:job:fire-direct",
      scope: personalScope(),
      taskContractVersion: "1.0.0",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    expect(opened.record.entrypoint).toBe("cron");
    expect(cron.entrypoint).toBe("cron");

    const chat = new ChatTaskOutcomeAdapter(service);
    const chatOpened = chat.createOrRestore({
      taskId: "chat:direct",
      scope: personalScope("subject:chat"),
      taskContractVersion: "1.0.0",
    });
    expect(chatOpened.ok).toBe(true);
    if (chatOpened.ok) {
      expect(chatOpened.record.entrypoint).toBe("chat");
    }
  });
});
