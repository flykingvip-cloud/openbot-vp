import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeDiagnosisDaibaiDeliveryId,
  createDiagnosisDaibaiDeliveryQueue,
  createMemoryDaibaiTransport,
  createUnavailableDaibaiTransport,
  redactDiagnosisDaibaiDelivery,
  routeDiagnosisDaibaiDelivery,
  type DiagnosisDaibaiDeliveryAuth,
} from "./daibai-delivery.js";
import type { DiagnosticSignal } from "./signal.js";
import type { DiagnosticTarget } from "./types.js";

const TENANT_A = "tenant-fixture-a";

function target(over: Partial<DiagnosticTarget> = {}): DiagnosticTarget {
  return {
    schemaVersion: 1,
    targetType: "session",
    targetId: "session-a",
    tenantId: TENANT_A,
    authority: "session_store",
    scope: { sessionKeyHash: "sha256:session-a" },
    ...over,
  };
}

function signal(over: Partial<DiagnosticSignal> = {}): DiagnosticSignal {
  return {
    schemaVersion: 1,
    signalId: "sig:scheduled:tenant-fixture-a:session:session-a:inspection_scheduled:1",
    kind: "scheduled",
    tenantId: TENANT_A,
    fingerprint: "scheduled|tenant-fixture-a|session:session-a|inspection_scheduled",
    status: "open",
    target: target(),
    evidenceIds: ["ev-a"],
    findingIds: ["find-a"],
    caseId: "case-open",
    completion: "CONFIRMED",
    reasonCode: "inspection_scheduled",
    occurrenceCount: 1,
    retryCount: 0,
    observedAt: "2026-09-03T02:00:00.000Z",
    lastSeenAt: "2026-09-03T02:00:00.000Z",
    expiresAt: "2026-09-03T03:00:00.000Z",
    ...over,
  };
}

describe("Phase 5 — Da Bai diagnosis delivery contract", () => {
  it("routes platform, enterprise, and employee audiences only with explicit auth", () => {
    expect(
      routeDiagnosisDaibaiDelivery(signal({ tenantId: null, target: target({ tenantId: null }) })),
    ).toBe("platform");
    expect(routeDiagnosisDaibaiDelivery(signal(), { sessionKind: "platform-admin" })).toBe(
      "platform",
    );
    expect(routeDiagnosisDaibaiDelivery(signal(), { sessionDomain: "platform" })).toBe("platform");
    expect(
      routeDiagnosisDaibaiDelivery(
        signal({ target: target({ targetType: "gateway", targetId: "gw-1" }) }),
        { sessionKind: "platform-admin" },
      ),
    ).toBe("platform");
    expect(routeDiagnosisDaibaiDelivery(signal(), { sessionDomain: "enterprise" })).toBe(
      "enterprise",
    );
    expect(
      routeDiagnosisDaibaiDelivery(signal(), { capabilities: ["diagnosis.report_admin"] }),
    ).toBe("enterprise");
    expect(routeDiagnosisDaibaiDelivery(signal(), { sessionDomain: "employee" })).toBe("employee");
  });

  it("fails closed without auth, with a wrong sessionDomain, or on privilege escalation", () => {
    expect(routeDiagnosisDaibaiDelivery(signal())).toBe("no_recipient");
    expect(routeDiagnosisDaibaiDelivery(signal(), {})).toBe("no_recipient");
    expect(
      routeDiagnosisDaibaiDelivery(signal(), {
        sessionDomain: "guest" as DiagnosisDaibaiDeliveryAuth["sessionDomain"],
      }),
    ).toBe("unauthorized");
    expect(routeDiagnosisDaibaiDelivery(signal(), { sessionKind: "user" })).toBe("unauthorized");
    expect(
      routeDiagnosisDaibaiDelivery(
        signal({ target: target({ targetType: "gateway", targetId: "gw-1" }) }),
      ),
    ).toBe("no_recipient");
    expect(routeDiagnosisDaibaiDelivery(signal(), { sessionDomain: "employee" })).not.toBe(
      "enterprise",
    );
    expect(routeDiagnosisDaibaiDelivery(signal(), { sessionDomain: "employee" })).not.toBe(
      "platform",
    );
    expect(
      routeDiagnosisDaibaiDelivery(
        signal({ target: target({ targetType: "gateway", targetId: "gw-1" }) }),
        { sessionDomain: "employee" },
      ),
    ).toBe("employee");
    expect(
      routeDiagnosisDaibaiDelivery(signal(), {
        sessionDomain: "employee",
        capabilities: ["diagnosis.local_read"],
      }),
    ).toBe("employee");
  });

  it("redacts sensitive signal fields by route", () => {
    const raw = signal();
    const employee = redactDiagnosisDaibaiDelivery(raw, "employee");
    expect(employee.route).toBe("employee");
    expect(employee.targetType).toBe("session");
    expect(employee.caseId).toBeUndefined();
    expect(employee.targetId).toBeUndefined();
    expect(employee.findingIds).toBeUndefined();
    expect(employee.evidenceIds).toBeUndefined();
    expect(JSON.stringify(employee)).not.toContain("sha256:session-a");
    expect(JSON.stringify(employee)).not.toContain("session_store");
    expect(JSON.stringify(employee)).not.toContain("ev-a");

    const enterprise = redactDiagnosisDaibaiDelivery(raw, "enterprise");
    expect(enterprise.caseId).toBe("case-open");
    expect(enterprise.targetId).toBe("session-a");
    expect(enterprise.evidenceIds).toBeUndefined();
    expect(JSON.stringify(enterprise)).not.toContain("sha256:session-a");

    const platform = redactDiagnosisDaibaiDelivery(raw, "platform");
    expect(platform.findingIds).toEqual(["find-a"]);
    expect(platform.evidenceIds).toEqual(["ev-a"]);
    expect(JSON.stringify(platform)).not.toContain("sha256:session-a");
    expect(JSON.stringify(platform)).not.toContain("prompt");
  });

  it("is idempotent and records receipts when the transport accepts", async () => {
    const transport = createMemoryDaibaiTransport();
    const queue = createDiagnosisDaibaiDeliveryQueue({
      now: () => Date.parse("2026-09-03T02:10:00.000Z"),
      transport,
    });
    const first = await queue.enqueue(signal(), { sessionDomain: "employee" });
    const second = await queue.enqueue(signal(), { sessionDomain: "employee" });
    expect(first.deliveryId).toBe(computeDiagnosisDaibaiDeliveryId(signal().signalId, "employee"));
    expect(second).toEqual(first);
    expect(first.status).toBe("accepted");
    expect(first.deliveredAt).toBe("2026-09-03T02:10:00.000Z");
    expect(transport.projections).toHaveLength(1);
    expect(queue.getReceipt(first.deliveryId)?.status).toBe("accepted");
  });

  it("rejects enqueue without authorization and never enters pending", async () => {
    const transport = createMemoryDaibaiTransport();
    const queue = createDiagnosisDaibaiDeliveryQueue({
      now: () => Date.parse("2026-09-03T02:15:00.000Z"),
      transport,
    });
    const missing = await queue.enqueue(signal());
    expect(missing.status).toBe("rejected");
    expect(missing.reason).toBe("authorization_required");
    expect(missing.route).toBe("no_recipient");
    expect(missing.attempt).toBe(0);
    expect(queue.listPending(TENANT_A)).toEqual([]);
    expect(transport.projections).toEqual([]);
    expect(await queue.enqueue(signal())).toEqual(missing);

    const wrongDomain = await queue.enqueue(signal({ signalId: "sig-wrong-domain" }), {
      sessionDomain: "guest" as DiagnosisDaibaiDeliveryAuth["sessionDomain"],
    });
    expect(wrongDomain.status).toBe("rejected");
    expect(wrongDomain.reason).toBe("unauthorized");
    expect(wrongDomain.route).toBe("unauthorized");
    expect(queue.listPending(TENANT_A)).toEqual([]);

    const userKind = await queue.enqueue(signal({ signalId: "sig-user-kind" }), {
      sessionKind: "user",
    });
    expect(userKind.status).toBe("rejected");
    expect(userKind.reason).toBe("unauthorized");
    expect(queue.listPending()).toEqual([]);
    expect(transport.projections).toEqual([]);
  });

  it("queues while Da Bai is unavailable, retries, then expires", async () => {
    let now = Date.parse("2026-09-03T02:20:00.000Z");
    const down = createDiagnosisDaibaiDeliveryQueue({
      now: () => now,
      transport: createUnavailableDaibaiTransport(),
      maxRetries: 2,
      ttlMs: 60_000,
    });
    const queued = await down.enqueue(signal(), { sessionDomain: "enterprise" });
    expect(queued.status).toBe("queued");
    expect(queued.reason).toBe("daibai_unavailable");
    expect(down.listPending(TENANT_A)).toHaveLength(1);
    expect(down.listPending("tenant-other")).toEqual([]);

    const retried = await down.flush();
    expect(retried[0]?.status).toBe("retried");
    expect(retried[0]?.attempt).toBe(2);
    const exhausted = await down.flush();
    expect(exhausted[0]?.status).toBe("rejected");
    expect(exhausted[0]?.reason).toBe("retry_exhausted");

    let available = false;
    const recoveringTransport = {
      projections: [] as Array<{ signalId: string }>,
      async deliver(projection: { signalId: string }) {
        if (!available) {
          return "unavailable" as const;
        }
        this.projections.push(projection);
        return "accepted" as const;
      },
    };
    const recovering = createDiagnosisDaibaiDeliveryQueue({
      now: () => now,
      transport: recoveringTransport,
    });
    await recovering.enqueue(signal({ signalId: "sig-recover" }), { sessionDomain: "employee" });
    expect(recovering.listPending(TENANT_A)).toHaveLength(1);
    available = true;
    const recovered = await recovering.flush();
    expect(recovered[0]?.status).toBe("accepted");
    expect(recoveringTransport.projections[0]?.signalId).toBe("sig-recover");
    expect(recovering.listPending(TENANT_A)).toEqual([]);

    const expiring = createDiagnosisDaibaiDeliveryQueue({
      now: () => now,
      transport: createUnavailableDaibaiTransport(),
      ttlMs: 1_000,
    });
    const held = await expiring.enqueue(
      signal({ signalId: "sig-expire", expiresAt: "2026-09-03T02:20:01.000Z" }),
      { sessionDomain: "employee" },
    );
    expect(held.status).toBe("queued");
    now += 2_000;
    expect((await expiring.flush())[0]?.status).toBe("expired");
    expect(expiring.listPending(TENANT_A)).toEqual([]);
  });

  it("does not call live Da Bai, chat, or the message transcript", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "daibai-delivery.ts"),
      "utf8",
    );
    expect(source).toContain("Does not call live Da Bai");
    expect(source).not.toContain("user.daibai.ask");
    expect(source).not.toContain("user.daibai.execute");
    expect(source).not.toContain("appendSkillInvocationEvent");
    expect(source).not.toContain("DiagnosisJournal");
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain("writeConfigFile");
    expect(source).not.toContain('from "../gateway/server-methods/daibai');
  });
});
