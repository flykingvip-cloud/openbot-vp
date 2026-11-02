import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { ensureChatTurnTaskOutcome } from "./chat-entry.js";
import {
  CORRECTION_NOTIFY_ENABLED,
  deliverCorrectionNotice,
  maybeNotifyLandedCorrection,
} from "./correction-notify.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function correctionFixture(opts?: { subjectRef?: string; tenantId?: string }) {
  const subjectRef = opts?.subjectRef ?? "platform-user:alice";
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "correction-notify-"));
  dirs.push(agentDir);
  const cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
  const opened = ensureChatTurnTaskOutcome(cfg, {
    agentId: "bot",
    runId: "run-1",
    sessionKey: "sess-a",
    subjectRef,
    ...(opts?.tenantId ? { tenantId: opts.tenantId } : {}),
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
    taskId: opened.taskId,
    outcomeVersion: corrected.outcomeVersion,
    negatedOutcomeVersion: snap.outcomeVersion,
    root,
    subjectRef,
    tenantId: opts?.tenantId,
  };
}

function noticeInput(
  fixture: ReturnType<typeof correctionFixture>,
  extra?: {
    enabled?: boolean;
    subjectRef?: string;
    verifiedPlatformUserId?: string;
    callerTenantId?: string | null;
    mappingVerified?: boolean;
    judgement?: string;
    send?: (input: {
      platformUserId: string;
      text: string;
    }) => { accepted: boolean } | Promise<{ accepted: boolean }>;
  },
) {
  return {
    cfg: fixture.cfg,
    agentId: "bot",
    taskId: fixture.taskId,
    negatedOutcomeVersion: fixture.negatedOutcomeVersion,
    correctionOutcomeVersion: fixture.outcomeVersion,
    judgement: extra?.judgement ?? "failure",
    revisionKind: "correction" as const,
    subjectRef: extra?.subjectRef ?? fixture.subjectRef,
    ...(fixture.tenantId ? { callerTenantId: fixture.tenantId } : {}),
    ...(extra?.callerTenantId !== undefined ? { callerTenantId: extra.callerTenantId } : {}),
    verifiedPlatformUserId: extra?.verifiedPlatformUserId,
    mappingVerified: extra?.mappingVerified,
    enabled: extra?.enabled,
    send: extra?.send,
  };
}

describe("correction notice", () => {
  it("stays off and does not send even when the correction identity would match", async () => {
    expect(CORRECTION_NOTIFY_ENABLED).toBe(false);
    const fixture = correctionFixture();
    const sent: string[] = [];
    const result = await maybeNotifyLandedCorrection(
      noticeInput(fixture, {
        verifiedPlatformUserId: fixture.subjectRef,
        mappingVerified: true,
        send: (input) => {
          sent.push(input.platformUserId);
          return { accepted: true };
        },
      }),
    );
    expect(result).toEqual({ ok: false, code: "not_enabled" });
    expect(sent).toEqual([]);
    expect(fs.existsSync(path.join(fixture.root, "correction-notify"))).toBe(false);
    expect(new DurableTaskOutcomeStore(fixture.root).loadTask(fixture.taskId)?.taskJudgement).toBe(
      "failure",
    );
  });

  it("fails closed for a wrong mapping even when the caller says it was verified", async () => {
    const fixture = correctionFixture();
    const sent: string[] = [];
    const send = (input: { platformUserId: string; text: string }) => {
      sent.push(input.platformUserId);
      return { accepted: true };
    };
    const wrongUser = await deliverCorrectionNotice(
      noticeInput(fixture, {
        enabled: true,
        mappingVerified: true,
        verifiedPlatformUserId: "platform-user:mallory",
        send,
      }),
    );
    expect(wrongUser).toEqual({ ok: false, code: "recipient_unresolved" });

    const wrongSubject = await deliverCorrectionNotice(
      noticeInput(fixture, {
        enabled: true,
        mappingVerified: true,
        subjectRef: "platform-user:mallory",
        verifiedPlatformUserId: "platform-user:mallory",
        send,
      }),
    );
    expect(wrongSubject).toEqual({ ok: false, code: "recipient_unresolved" });

    const forbidden = await deliverCorrectionNotice(
      noticeInput(fixture, {
        enabled: true,
        mappingVerified: true,
        verifiedPlatformUserId: "agent:main:main",
        send,
      }),
    );
    expect(forbidden).toEqual({ ok: false, code: "recipient_unresolved" });
    expect(JSON.stringify(forbidden)).not.toContain("diagnosis:canary:daibai");
    expect(sent).toEqual([]);
    expect(fs.existsSync(path.join(fixture.root, "correction-notify"))).toBe(false);
    expect(new DurableTaskOutcomeStore(fixture.root).loadTask(fixture.taskId)?.taskJudgement).toBe(
      "failure",
    );
  });

  it("refuses a stored subject that is a forbidden fallback session", async () => {
    const fixture = correctionFixture({ subjectRef: "agent:main:main" });
    const sent: string[] = [];
    const result = await deliverCorrectionNotice(
      noticeInput(fixture, {
        enabled: true,
        mappingVerified: true,
        verifiedPlatformUserId: "agent:main:main",
        send: (input) => {
          sent.push(input.platformUserId);
          return { accepted: true };
        },
      }),
    );
    expect(result).toEqual({ ok: false, code: "recipient_unresolved" });
    expect(sent).toEqual([]);
  });

  it("sends from the stored subject, accepts async injection, and does not dedup a thrown send", async () => {
    const fixture = correctionFixture();
    const sent: Array<{ platformUserId: string; text: string }> = [];
    const thrown = await deliverCorrectionNotice(
      noticeInput(fixture, {
        enabled: true,
        mappingVerified: false,
        verifiedPlatformUserId: fixture.subjectRef,
        send: async () => {
          throw new Error("inject failed");
        },
      }),
    );
    expect(thrown).toEqual({ ok: false, code: "delivery_failed" });
    const receiptDir = path.join(fixture.root, "correction-notify");
    const receiptFiles = fs.existsSync(receiptDir)
      ? fs.readdirSync(receiptDir).filter((name) => name.endsWith(".json"))
      : [];
    expect(receiptFiles).toEqual([]);

    const first = await deliverCorrectionNotice(
      noticeInput(fixture, {
        enabled: true,
        mappingVerified: false,
        verifiedPlatformUserId: fixture.subjectRef,
        send: async (input) => {
          sent.push(input);
          return { accepted: true };
        },
      }),
    );
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.replayed).toBe(false);
      expect(first.accepted).toBe(true);
      expect(first.read).toBe(false);
      expect(first.text).toContain(`任务 ${fixture.taskId}`);
      expect(first.text).toContain(`被否定版本 ${fixture.negatedOutcomeVersion}`);
      expect(first.text).toContain(`纠正版本 ${fixture.outcomeVersion}`);
      expect(first.text).toContain("判定 failure");
      expect(first.text).toContain("这是纠正记录，不是重新执行。");
    }
    const second = await deliverCorrectionNotice(
      noticeInput(fixture, {
        enabled: true,
        mappingVerified: true,
        verifiedPlatformUserId: fixture.subjectRef,
        send: (input) => {
          sent.push(input);
          return { accepted: true };
        },
      }),
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.replayed).toBe(true);
      expect(second.read).toBe(false);
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]?.platformUserId).toBe(fixture.subjectRef);
    const tip = new DurableTaskOutcomeStore(fixture.root).loadTask(fixture.taskId);
    expect(tip?.taskJudgement).toBe("failure");
    expect(tip?.outcomeVersion).toBe(fixture.outcomeVersion);
  });

  it("requires the enterprise tenant stored on the correction", async () => {
    const fixture = correctionFixture({ tenantId: "tenant-a" });
    const sent: string[] = [];
    const send = (input: { platformUserId: string; text: string }) => {
      sent.push(input.platformUserId);
      return { accepted: true };
    };
    const wrongTenant = await deliverCorrectionNotice(
      noticeInput(fixture, {
        enabled: true,
        callerTenantId: "tenant-b",
        verifiedPlatformUserId: fixture.subjectRef,
        mappingVerified: true,
        send,
      }),
    );
    expect(wrongTenant).toEqual({ ok: false, code: "recipient_unresolved" });
    expect(sent).toEqual([]);

    const matched = await deliverCorrectionNotice(
      noticeInput(fixture, {
        enabled: true,
        callerTenantId: "tenant-a",
        verifiedPlatformUserId: fixture.subjectRef,
        mappingVerified: false,
        send,
      }),
    );
    expect(matched.ok).toBe(true);
    if (matched.ok) {
      expect(matched.replayed).toBe(false);
    }
    expect(sent).toEqual([fixture.subjectRef]);
  });
});
