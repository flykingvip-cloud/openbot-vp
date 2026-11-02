import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { diagnosisTaskOutcomeRows } from "../../ui/src/ui/ports/enterprise/diagnosis/diagnosis-task-outcome-rows.ts";
import type { OpenBotConfig } from "../config/config.js";
import {
  formatTaskOutcomeEvidenceText,
  readTaskOutcomeEvidence,
} from "../diagnosis/task-outcome-evidence.js";
import { ensureChatTurnTaskOutcome } from "./chat-entry.js";
import { deliverCorrectionNotice } from "./correction-notify.js";
import { executeOriginalScenarioRecheck, type RecheckRunResult } from "./recheck-executor.js";
import {
  readRecheckObservation,
  recheckObservationFilePath,
  recordRecheckObservation,
} from "./recheck-observation.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";

const dirs: string[] = [];
const childPath = fileURLToPath(new URL("./recheck-notify-hardening-child.ts", import.meta.url));
const repoRoot = path.resolve(path.dirname(childPath), "../..");

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function correctionFixture() {
  const subjectRef = "platform-user:alice";
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "recheck-harden-"));
  dirs.push(agentDir);
  const cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
  const opened = ensureChatTurnTaskOutcome(cfg, {
    agentId: "bot",
    runId: "run-1",
    sessionKey: "sess-a",
    subjectRef,
  });
  if (!opened.ok) {
    throw new Error(opened.message);
  }
  const root = path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME);
  const store = new DurableTaskOutcomeStore(root);
  const snap = store.loadTaskVersion(opened.taskId, opened.record.outcomeVersion);
  const tip = store.loadTask(opened.taskId);
  if (!snap || !tip) {
    throw new Error("missing snapshot");
  }
  const corrected = {
    ...snap,
    outcomeVersion: snap.outcomeVersion + 1,
    previousOutcomeVersion: snap.outcomeVersion,
    revisionKind: "correction" as const,
    taskJudgement: "failure" as const,
    decisiveRunId: "run-1",
    taskContractVersion: snap.taskContractVersion,
  };
  fs.writeFileSync(
    store.versionPath(opened.taskId, corrected.outcomeVersion),
    `${JSON.stringify(corrected, null, 2)}\n`,
  );
  fs.writeFileSync(
    store.tipPath(opened.taskId),
    `${JSON.stringify({ ...tip, ...corrected }, null, 2)}\n`,
  );
  store.close();
  return {
    cfg,
    agentDir,
    taskId: opened.taskId,
    outcomeVersion: corrected.outcomeVersion,
    negatedOutcomeVersion: snap.outcomeVersion,
    root,
    subjectRef,
    taskContractVersion: corrected.taskContractVersion,
    scenarioId: "run-1",
  };
}

function runChild(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", childPath, ...args], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function readChildResult(outFile: string): { ok: boolean; [key: string]: unknown } {
  return JSON.parse(fs.readFileSync(outFile, "utf8")) as { ok: boolean; [key: string]: unknown };
}

async function waitForFile(filePath: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    if (fs.existsSync(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

function prove(fixture: ReturnType<typeof correctionFixture>, ok: boolean): RecheckRunResult {
  if (!ok) {
    return { ok: false, reason: "failed" };
  }
  return {
    ok: true,
    taskId: fixture.taskId,
    outcomeVersion: fixture.outcomeVersion,
    taskContractVersion: fixture.taskContractVersion,
    scenarioId: fixture.scenarioId,
  };
}

describe("recheck and notify hardening", () => {
  it("keeps later attempts and shows the same attempt the executor returned", async () => {
    const fixture = correctionFixture();
    const failed = await executeOriginalScenarioRecheck({
      cfg: fixture.cfg,
      agentId: "bot",
      taskId: fixture.taskId,
      outcomeVersion: fixture.outcomeVersion,
      taskContractVersion: fixture.taskContractVersion,
      scenarioId: fixture.scenarioId,
      enabled: true,
      run: () => prove(fixture, false),
    });
    expect(failed).toEqual({
      ok: true,
      status: "incomplete",
      outcomeVersion: fixture.outcomeVersion,
      attempt: 1,
    });
    const succeeded = await executeOriginalScenarioRecheck({
      cfg: fixture.cfg,
      agentId: "bot",
      taskId: fixture.taskId,
      outcomeVersion: fixture.outcomeVersion,
      taskContractVersion: fixture.taskContractVersion,
      scenarioId: fixture.scenarioId,
      enabled: true,
      run: (scenario) => {
        expect(scenario).toEqual({
          taskId: fixture.taskId,
          outcomeVersion: fixture.outcomeVersion,
          taskContractVersion: fixture.taskContractVersion,
          scenarioId: fixture.scenarioId,
        });
        return prove(fixture, true);
      },
    });
    expect(succeeded).toEqual({
      ok: true,
      status: "completed",
      outcomeVersion: fixture.outcomeVersion,
      attempt: 2,
    });
    const evidence = readTaskOutcomeEvidence({
      cfg: fixture.cfg,
      agentId: "bot",
      taskId: fixture.taskId,
      outcomeVersion: fixture.outcomeVersion,
      callerSubjectRaw: fixture.subjectRef,
    });
    expect(evidence.ok).toBe(true);
    if (evidence.ok && succeeded.ok) {
      expect(evidence.recheckStatus).toBe(succeeded.status);
      expect(evidence.recheckAttempt).toBe(succeeded.attempt);
      expect(evidence.judgement).toBe("failure");
      const label = diagnosisTaskOutcomeRows({
        sourceLabel: "数字人 客服",
        evidence,
      }).find((row) => row.label === "复验结果")?.value;
      expect(label).toBe("第2次复验已记录");
      expect(formatTaskOutcomeEvidenceText(evidence)).toContain("第2次复验已记录");
    }
    const history = readRecheckObservation(fixture.root, fixture.taskId, fixture.outcomeVersion);
    expect(history.ok).toBe(true);
    if (history.ok) {
      expect(history.attempts).toEqual([
        { attempt: 1, status: "incomplete" },
        { attempt: 2, status: "completed" },
      ]);
    }

    const reversed = correctionFixture();
    const firstOk = await executeOriginalScenarioRecheck({
      cfg: reversed.cfg,
      agentId: "bot",
      taskId: reversed.taskId,
      outcomeVersion: reversed.outcomeVersion,
      taskContractVersion: reversed.taskContractVersion,
      scenarioId: reversed.scenarioId,
      enabled: true,
      run: () => prove(reversed, true),
    });
    const secondFail = await executeOriginalScenarioRecheck({
      cfg: reversed.cfg,
      agentId: "bot",
      taskId: reversed.taskId,
      outcomeVersion: reversed.outcomeVersion,
      taskContractVersion: reversed.taskContractVersion,
      scenarioId: reversed.scenarioId,
      enabled: true,
      run: () => prove(reversed, false),
    });
    expect(firstOk).toMatchObject({ ok: true, status: "completed", attempt: 1 });
    expect(secondFail).toMatchObject({ ok: true, status: "incomplete", attempt: 2 });
    const reversedEvidence = readTaskOutcomeEvidence({
      cfg: reversed.cfg,
      agentId: "bot",
      taskId: reversed.taskId,
      outcomeVersion: reversed.outcomeVersion,
      callerSubjectRaw: reversed.subjectRef,
    });
    expect(reversedEvidence.ok).toBe(true);
    if (reversedEvidence.ok && secondFail.ok) {
      expect(reversedEvidence.recheckStatus).toBe("incomplete");
      expect(reversedEvidence.recheckAttempt).toBe(2);
      expect(
        diagnosisTaskOutcomeRows({
          sourceLabel: "数字人 客服",
          evidence: reversedEvidence,
        }).find((row) => row.label === "复验结果")?.value,
      ).toBe("第2次复验未完成");
    }
    expect(
      new DurableTaskOutcomeStore(reversed.root).loadTask(reversed.taskId)?.taskJudgement,
    ).toBe("failure");
  });

  it("does not record a fake binding or a bare success as completed", async () => {
    const fixture = correctionFixture();
    let calls = 0;
    const fake = await executeOriginalScenarioRecheck({
      cfg: fixture.cfg,
      agentId: "bot",
      taskId: fixture.taskId,
      outcomeVersion: fixture.outcomeVersion,
      taskContractVersion: fixture.taskContractVersion,
      scenarioId: "scene-1",
      enabled: true,
      run: () => {
        calls += 1;
        return prove(fixture, true);
      },
    });
    expect(fake).toEqual({ ok: false, code: "binding_mismatch" });
    expect(calls).toBe(0);
    expect(
      readRecheckObservation(fixture.root, fixture.taskId, fixture.outcomeVersion),
    ).toMatchObject({
      ok: true,
      status: "not_checked",
    });

    const bare = await executeOriginalScenarioRecheck({
      cfg: fixture.cfg,
      agentId: "bot",
      taskId: fixture.taskId,
      outcomeVersion: fixture.outcomeVersion,
      taskContractVersion: fixture.taskContractVersion,
      scenarioId: fixture.scenarioId,
      enabled: true,
      run: () => ({ ok: true }) as RecheckRunResult,
    });
    expect(bare).toEqual({ ok: false, code: "binding_mismatch" });
    expect(
      readRecheckObservation(fixture.root, fixture.taskId, fixture.outcomeVersion),
    ).toMatchObject({
      ok: true,
      status: "not_checked",
    });
    expect(new DurableTaskOutcomeStore(fixture.root).loadTask(fixture.taskId)?.taskJudgement).toBe(
      "failure",
    );
  });

  it("distinguishes a broken observation file from no recheck and survives a killed writer", async () => {
    const fixture = correctionFixture();
    const first = await recordRecheckObservation({
      rootDir: fixture.root,
      taskId: fixture.taskId,
      outcomeVersion: fixture.outcomeVersion,
      status: "incomplete",
    });
    expect(first).toEqual({ ok: true, attempt: 1, status: "incomplete" });
    const filePath = recheckObservationFilePath(fixture.root, fixture.taskId);
    const intact = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(`${filePath}.999.abandoned.tmp`, "{", "utf8");
    expect(
      readRecheckObservation(fixture.root, fixture.taskId, fixture.outcomeVersion),
    ).toMatchObject({
      ok: true,
      status: "incomplete",
      attempt: 1,
    });

    fs.writeFileSync(filePath, "{", "utf8");
    expect(readRecheckObservation(fixture.root, fixture.taskId, fixture.outcomeVersion)).toEqual({
      ok: false,
      code: "read_failed",
    });
    const brokenEvidence = readTaskOutcomeEvidence({
      cfg: fixture.cfg,
      agentId: "bot",
      taskId: fixture.taskId,
      outcomeVersion: fixture.outcomeVersion,
      callerSubjectRaw: fixture.subjectRef,
    });
    expect(brokenEvidence.ok).toBe(true);
    if (brokenEvidence.ok) {
      expect(brokenEvidence.recheckStatus).toBe("read_failed");
      expect(brokenEvidence.judgement).toBe("failure");
      expect(
        diagnosisTaskOutcomeRows({
          sourceLabel: "数字人 客服",
          evidence: brokenEvidence,
        }).find((row) => row.label === "复验结果")?.value,
      ).toBe("复验记录读取失败");
      expect(formatTaskOutcomeEvidenceText(brokenEvidence)).toContain("复验记录读取失败");
      expect(formatTaskOutcomeEvidenceText(brokenEvidence)).not.toContain("未复验");
    }
    const refused = await recordRecheckObservation({
      rootDir: fixture.root,
      taskId: fixture.taskId,
      outcomeVersion: fixture.outcomeVersion,
      status: "completed",
    });
    expect(refused).toEqual({ ok: false, code: "storage_failed" });
    expect(fs.readFileSync(filePath, "utf8")).toBe("{");

    fs.writeFileSync(filePath, intact, "utf8");
    const ready = path.join(fixture.agentDir, "lock-ready");
    const holder = spawn(
      process.execPath,
      ["--import", "tsx", childPath, "hold-lock", fixture.root, fixture.taskId, ready],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    await waitForFile(ready);
    holder.kill("SIGKILL");
    await new Promise((resolve) => holder.on("exit", resolve));
    const recovered = await recordRecheckObservation({
      rootDir: fixture.root,
      taskId: fixture.taskId,
      outcomeVersion: fixture.outcomeVersion,
      status: "completed",
    });
    expect(recovered).toEqual({ ok: true, attempt: 2, status: "completed" });
    expect(
      readRecheckObservation(fixture.root, fixture.taskId, fixture.outcomeVersion),
    ).toMatchObject({
      ok: true,
      status: "completed",
      attempt: 2,
      attempts: [
        { attempt: 1, status: "incomplete" },
        { attempt: 2, status: "completed" },
      ],
    });
  }, 90_000);

  it("keeps both concurrent observation writes", async () => {
    const fixture = correctionFixture();
    const outA = path.join(fixture.agentDir, "a.json");
    const outB = path.join(fixture.agentDir, "b.json");
    const [first, second] = await Promise.all([
      runChild([
        "record",
        fixture.root,
        fixture.taskId,
        String(fixture.outcomeVersion),
        "incomplete",
        outA,
      ]),
      runChild([
        "record",
        fixture.root,
        fixture.taskId,
        String(fixture.outcomeVersion),
        "completed",
        outB,
      ]),
    ]);
    expect(first.code, first.stderr).toBe(0);
    expect(second.code, second.stderr).toBe(0);
    const view = readRecheckObservation(fixture.root, fixture.taskId, fixture.outcomeVersion);
    expect(view.ok).toBe(true);
    if (view.ok) {
      expect(view.attempts).toHaveLength(2);
      expect(view.attempts.map((row) => row.status).toSorted()).toEqual([
        "completed",
        "incomplete",
      ]);
      expect(view.attempt).toBe(2);
    }
  }, 120_000);

  it("keeps a delivery fact after the sending process exits", async () => {
    const fixture = correctionFixture();
    const sentLog = path.join(fixture.agentDir, "sent.log");
    const payloadPath = path.join(fixture.agentDir, "payload.json");
    fs.writeFileSync(
      payloadPath,
      JSON.stringify({
        agentDir: fixture.agentDir,
        agentId: "bot",
        taskId: fixture.taskId,
        negatedOutcomeVersion: fixture.negatedOutcomeVersion,
        correctionOutcomeVersion: fixture.outcomeVersion,
        judgement: "failure",
        subjectRef: fixture.subjectRef,
        verifiedPlatformUserId: fixture.subjectRef,
        sentLog,
      }),
    );
    const firstOut = path.join(fixture.agentDir, "notify-1.json");
    const secondOut = path.join(fixture.agentDir, "notify-2.json");
    const first = await runChild(["notify", payloadPath, firstOut]);
    expect(first.code, first.stderr).toBe(0);
    expect(readChildResult(firstOut)).toMatchObject({
      ok: true,
      replayed: false,
      accepted: true,
      read: false,
    });
    const second = await runChild(["notify", payloadPath, secondOut]);
    expect(second.code, second.stderr).toBe(0);
    expect(readChildResult(secondOut)).toMatchObject({
      ok: true,
      replayed: true,
      accepted: true,
      read: false,
    });
    expect(fs.readFileSync(sentLog, "utf8")).toBe("sent\n");
    const tip = new DurableTaskOutcomeStore(fixture.root).loadTask(fixture.taskId);
    expect(tip?.taskJudgement).toBe("failure");
    expect(tip?.outcomeVersion).toBe(fixture.outcomeVersion);

    const again = await deliverCorrectionNotice({
      enabled: true,
      cfg: fixture.cfg,
      agentId: "bot",
      taskId: fixture.taskId,
      negatedOutcomeVersion: fixture.negatedOutcomeVersion,
      correctionOutcomeVersion: fixture.outcomeVersion,
      judgement: "failure",
      revisionKind: "correction",
      subjectRef: fixture.subjectRef,
      verifiedPlatformUserId: fixture.subjectRef,
      mappingVerified: true,
      send: () => {
        fs.appendFileSync(sentLog, "sent\n");
        return { accepted: true };
      },
    });
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(fs.readFileSync(sentLog, "utf8")).toBe("sent\n");
  }, 120_000);
});
