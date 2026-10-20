import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const evidencePath =
  "docs/design/evidence/conversation-identity-final-runtime-acceptance-2026-09-24.json";

type Receipt = {
  timestamp: string;
  action: string;
  executed: boolean;
  source: string;
  sessionDomain: string;
  tenantHash: string;
  membershipPresent: boolean;
  seatHash: string;
  agentHash: string;
  meetingIdHash: string;
  executionIdHash: string | null;
  httpStatus: number;
  providerSuccessCode: string | null;
  inviteesRequested?: boolean;
  notificationParameterPresent?: boolean;
  subjectFingerprint?: string;
};

type Evidence = {
  schemaVersion: number;
  observedAt: string;
  originMainSha: string;
  liveGatewaySha: string;
  liveUiSha: string | null;
  imageRevision: string;
  imageDigest: string;
  releaseSeq: number;
  productionProven: boolean;
  closeGateMet: boolean;
  ancestryChecks: Record<string, boolean>;
  webchatIdentitySource: string;
  environmentIdentityFallbackUsed: boolean;
  redactionConfirmed: boolean;
  residualMeeting: boolean;
  scheduleReceipt: Receipt;
  cancelReceipt: Receipt;
  postCancelVerification: {
    subjectRemaining: number;
    cancelledStateObserved: boolean;
  };
};

const gitSha = /^[0-9a-f]{40}$/;
const shortHash = /^sha256:[0-9a-f]{12}$/;
const imageDigest = /^sha256:[0-9a-f]{64}$/;
const forbidden = /cookie|token|secret|credential|https?:\/\//i;

function loadEvidence(): Evidence {
  return JSON.parse(readFileSync(evidencePath, "utf8")) as Evidence;
}

function walk(value: unknown, path: string, hits: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, hits));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && forbidden.test(value)) {
      hits.push(path);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.test(key)) {
      hits.push(`${path}.${key}`);
    }
    walk(child, `${path}.${key}`, hits);
  }
}

describe("conversation identity final runtime evidence", () => {
  const evidence = loadEvidence();

  it("records git and image identifiers in SHA form", () => {
    expect(evidence.schemaVersion).toBe(1);
    expect(evidence.originMainSha).toMatch(gitSha);
    expect(evidence.liveGatewaySha).toMatch(gitSha);
    expect(evidence.imageRevision).toMatch(gitSha);
    expect(evidence.imageDigest).toMatch(imageDigest);
    expect(evidence.liveUiSha).toBeNull();
    expect(evidence.releaseSeq).toBe(97);
  });

  it("keeps the four ancestry results false", () => {
    const checks = Object.entries(evidence.ancestryChecks);
    expect(checks).toHaveLength(4);
    for (const [sha, ancestor] of checks) {
      expect(sha).toMatch(gitSha);
      expect(ancestor).toBe(false);
    }
    expect(evidence.productionProven).toBe(false);
    expect(evidence.closeGateMet).toBe(false);
  });

  it("ties schedule and cancel to the same employee meeting", () => {
    expect(evidence.webchatIdentitySource).toBe("employee-tools-invoke");
    expect(evidence.scheduleReceipt.source).toBe("employee");
    expect(evidence.cancelReceipt.source).toBe("employee");
    expect(evidence.scheduleReceipt.sessionDomain).toBe("employee");
    expect(evidence.scheduleReceipt.executed).toBe(true);
    expect(evidence.cancelReceipt.executed).toBe(true);
    expect(evidence.scheduleReceipt.action).toBe("schedule_meeting");
    expect(evidence.cancelReceipt.action).toBe("cancel_meeting");
    expect(evidence.scheduleReceipt.meetingIdHash).toMatch(shortHash);
    expect(evidence.cancelReceipt.meetingIdHash).toBe(evidence.scheduleReceipt.meetingIdHash);
    expect(evidence.cancelReceipt.tenantHash).toBe(evidence.scheduleReceipt.tenantHash);
    expect(evidence.cancelReceipt.seatHash).toBe(evidence.scheduleReceipt.seatHash);
    expect(evidence.cancelReceipt.agentHash).toBe(evidence.scheduleReceipt.agentHash);
    expect(evidence.scheduleReceipt.membershipPresent).toBe(true);
    expect(Date.parse(evidence.cancelReceipt.timestamp)).toBeGreaterThan(
      Date.parse(evidence.scheduleReceipt.timestamp),
    );
    expect(evidence.scheduleReceipt.executionIdHash).toBeNull();
    expect(evidence.cancelReceipt.executionIdHash).toBeNull();
  });

  it("records no residual meeting and no environment identity fallback", () => {
    expect(evidence.residualMeeting).toBe(false);
    expect(evidence.environmentIdentityFallbackUsed).toBe(false);
    expect(evidence.postCancelVerification.subjectRemaining).toBe(0);
    expect(evidence.postCancelVerification.cancelledStateObserved).toBe(true);
    expect(evidence.scheduleReceipt.inviteesRequested).toBe(false);
    expect(evidence.redactionConfirmed).toBe(true);
  });

  it("does not contain urls or credential field names", () => {
    const hits: string[] = [];
    walk(evidence, "$", hits);
    expect(hits).toEqual([]);
  });
});
