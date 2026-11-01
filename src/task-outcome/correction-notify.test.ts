import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORRECTION_NOTIFY_ENABLED,
  deliverCorrectionNotice,
  maybeNotifyLandedCorrection,
  resetCorrectionNotifyReceiptsForTests,
} from "./correction-notify.js";

const base = {
  taskId: "task-1",
  negatedOutcomeVersion: 2,
  correctionOutcomeVersion: 3,
  judgement: "failure",
  revisionKind: "correction" as const,
  subjectRef: "agent:bot:main",
};

afterEach(() => {
  resetCorrectionNotifyReceiptsForTests();
});

describe("correction notice", () => {
  it("stays off, fails closed without a verified user, and sends one factual notice", () => {
    expect(CORRECTION_NOTIFY_ENABLED).toBe(false);
    const send = vi.fn(() => ({ accepted: true }));
    expect(maybeNotifyLandedCorrection({ ...base, send })).toEqual({
      ok: false,
      code: "not_enabled",
    });
    expect(send).not.toHaveBeenCalled();

    const unresolved = deliverCorrectionNotice({
      ...base,
      enabled: true,
      mappingVerified: false,
      send,
    });
    expect(unresolved).toEqual({ ok: false, code: "recipient_unresolved" });
    expect(JSON.stringify(unresolved)).not.toContain("agent:main:main");
    expect(JSON.stringify(unresolved)).not.toContain("diagnosis:canary:daibai");
    expect(send).not.toHaveBeenCalled();

    const forbidden = deliverCorrectionNotice({
      ...base,
      enabled: true,
      mappingVerified: true,
      verifiedPlatformUserId: "agent:main:main",
      send,
    });
    expect(forbidden).toEqual({ ok: false, code: "recipient_unresolved" });
    expect(send).not.toHaveBeenCalled();

    const first = deliverCorrectionNotice({
      ...base,
      enabled: true,
      mappingVerified: true,
      verifiedPlatformUserId: "platform-user:alice",
      send,
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.replayed).toBe(false);
      expect(first.read).toBe(false);
      expect(first.accepted).toBe(true);
      expect(first.text).toContain("任务 task-1");
      expect(first.text).toContain("被否定版本 2");
      expect(first.text).toContain("纠正版本 3");
      expect(first.text).toContain("判定 failure");
      expect(first.text).toContain("这是纠正记录，不是重新执行。");
    }
    const second = deliverCorrectionNotice({
      ...base,
      enabled: true,
      mappingVerified: true,
      verifiedPlatformUserId: "platform-user:alice",
      send,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.replayed).toBe(true);
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].platformUserId).toBe("platform-user:alice");
  });
});
