/**
 * E-M3-A1 / E-M3-A2 Class A confirm authorization matrix.
 * Path B CONFIRM exception 2026-10-19: DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED is true.
 * Omitting enabled follows the production constant; enabled:false still refuses.
 */
import { describe, expect, it } from "vitest";
import { evolutionPrescriptionContentHash } from "./diagnose-evolution-content-hash.js";
import {
  SCHEDULE_DIAGNOSIS_PRESCRIPTION_ACTION,
  confirmDiagnoseEvolutionPrescription,
  type EvolutionCronPort,
  type EvolutionPrescription,
  type PrescriptionGrantView,
} from "./diagnose-evolution-prescription.js";
import { DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED } from "./diagnose-professional-protocol.js";

const TENANT = "tenant-a";
const OWNER = "employee-9";
const AGENT = "bot-2";
const ASSET = "asset-bot-2";
const REPORT = "pdr-auth-matrix-1";
const RX_ID = "rx-auth-matrix-identity-001";
const NOW = Date.parse("2026-09-19T12:00:00.000Z");
const EXPIRES = "2026-09-20T12:00:00.000Z";

function basePrescription(over: Partial<EvolutionPrescription> = {}): EvolutionPrescription {
  const row: EvolutionPrescription = {
    prescriptionId: RX_ID,
    professionalReportId: REPORT,
    tenantId: TENANT,
    targetAgentAssetId: ASSET,
    targetAgentId: AGENT,
    targetOwnerId: OWNER,
    purpose: "identity",
    purposeLabel: "补身份",
    kind: "next_heartbeat_cron",
    normalizedSchedule: "next_heartbeat_cron|0 8 * * *",
    scheduleExpr: "0 8 * * *",
    cadenceLabel: "每天 08:00，下次心跳触发",
    expectedEffect: "向主人收集未确认字段",
    wakeText: "向主人请求补充未确认字段。不要自行编造 IDENTITY 或 USER。",
    payloadVersion: 1,
    schemaVersion: 1,
    state: "PENDING_CONFIRMATION",
    confirmable: true,
    authorizationRef: null,
    expiresAt: EXPIRES,
    appliedJobId: null,
    confirmReceipt: null,
    ...over,
  };
  row.prescriptionContentHash = evolutionPrescriptionContentHash(row);
  return row;
}

function store(initial: EvolutionPrescription) {
  const rows = new Map<string, EvolutionPrescription>([[initial.prescriptionId, { ...initial }]]);
  return {
    // Intentionally do not filter by tenantId here: production authorizePrescriptionConfirm
    // must emit cross_tenant when the loaded record's tenant differs from the request.
    loadRecord: (_tenantId: string, prescriptionId: string) => {
      const row = rows.get(prescriptionId);
      if (!row) {
        return null;
      }
      return { ...row };
    },
    saveRecord: (record: EvolutionPrescription) => {
      rows.set(record.prescriptionId, { ...record });
    },
    get: (id: string) => rows.get(id),
  };
}

function cronPort(seed: { id: string; name: string }[] = []): EvolutionCronPort & {
  added: { id: string; name: string }[];
} {
  const jobs = [...seed];
  const added: { id: string; name: string }[] = [];
  return {
    added,
    async add(job) {
      const id = `job-${jobs.length + 1}`;
      const row = { id, name: job.name ?? "" };
      jobs.push(row);
      added.push(row);
      return { id };
    },
    async list() {
      return jobs.map((job) => ({ id: job.id, name: job.name, agentId: AGENT }));
    },
  };
}

function proxyGrant(over: Partial<PrescriptionGrantView> = {}): PrescriptionGrantView {
  return {
    status: "APPROVED",
    tenantId: TENANT,
    targetPrincipal: OWNER,
    targetAgent: AGENT,
    allowedActions: [SCHEDULE_DIAGNOSIS_PRESCRIPTION_ACTION],
    purpose: "delegate:schedule_diagnosis_prescription",
    surfaceId: null,
    ...over,
  };
}

async function confirm(
  record: EvolutionPrescription,
  over: {
    callerUserId?: string;
    tenantId?: string;
    professionalReportId?: string;
    prescriptionContentHash?: string | null;
    enabled?: boolean;
    grant?: PrescriptionGrantView;
    cron?: ReturnType<typeof cronPort>;
    store?: ReturnType<typeof store>;
  } = {},
) {
  const db = over.store ?? store(record);
  const cron = over.cron ?? cronPort();
  const hash =
    over.prescriptionContentHash === null
      ? undefined
      : (over.prescriptionContentHash ?? record.prescriptionContentHash);
  const result = await confirmDiagnoseEvolutionPrescription({
    prescriptionId: record.prescriptionId,
    tenantId: over.tenantId ?? TENANT,
    professionalReportId: over.professionalReportId ?? REPORT,
    callerUserId: over.callerUserId,
    prescriptionContentHash: hash,
    ...(over.enabled !== undefined ? { enabled: over.enabled } : {}),
    nowMs: NOW,
    cron,
    inspectGrant: over.grant ? () => over.grant! : undefined,
    loadRecord: db.loadRecord,
    saveRecord: db.saveRecord,
  });
  return { result, cron, db };
}

describe("E-M3 Class A confirm auth matrix (Path B CONFIRM open)", () => {
  it("E-M3-CNF-01 keeps DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED true (Path B)", () => {
    expect(DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED).toBe(true);
  });

  it("E-M3-CNF-02a refuses when enabled:false is passed explicitly", async () => {
    const rx = basePrescription();
    const { result, cron } = await confirm(rx, {
      callerUserId: OWNER,
      enabled: false,
    });
    expect(result).toEqual({ ok: false, reason: "confirm_not_enabled" });
    expect(cron.added).toHaveLength(0);
  });

  it("E-M3-CNF-02b omits enabled (undefined) and follows production constant true", async () => {
    expect(DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED).toBe(true);
    const rx = basePrescription();
    const { result, cron, db } = await confirm(rx, {
      callerUserId: OWNER,
      // intentionally do not pass enabled — follows DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.already).toBe(false);
    expect(cron.added).toHaveLength(1);
    expect(db.get(RX_ID)?.state).toBe("APPLIED");
  });

  describe("E-M3-A1 owner path", () => {
    it("E-M3-A1-01 owner + same tenant schedules cron and writes confirmReceipt", async () => {
      const rx = basePrescription();
      const { result, cron, db } = await confirm(rx, {
        enabled: true,
        callerUserId: OWNER,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.already).toBe(false);
      expect(result.jobId).toBeTruthy();
      expect(cron.added).toHaveLength(1);
      expect(cron.added[0]?.name).toBe(`diagnosis-evolution:${RX_ID}`);
      const saved = db.get(RX_ID);
      expect(saved?.state).toBe("APPLIED");
      expect(saved?.confirmReceipt?.callerUserId).toBe(OWNER);
      expect(saved?.confirmReceipt?.prescriptionContentHash).toBe(rx.prescriptionContentHash);
    });

    it("E-M3-A1-02 missing callerUserId → caller_required", async () => {
      const { result, cron } = await confirm(basePrescription(), {
        enabled: true,
        callerUserId: "",
      });
      expect(result).toEqual({ ok: false, reason: "caller_required" });
      expect(cron.added).toHaveLength(0);
    });

    it("E-M3-A1-03 cross tenant → cross_tenant", async () => {
      const { result, cron } = await confirm(basePrescription(), {
        enabled: true,
        callerUserId: OWNER,
        tenantId: "tenant-other",
      });
      expect(result).toEqual({ ok: false, reason: "cross_tenant" });
      expect(cron.added).toHaveLength(0);
    });

    it("E-M3-A1-04 content hash mismatch → prescription_hash_mismatch", async () => {
      const { result, cron } = await confirm(basePrescription(), {
        enabled: true,
        callerUserId: OWNER,
        prescriptionContentHash: "deadbeef".repeat(8),
      });
      expect(result).toEqual({ ok: false, reason: "prescription_hash_mismatch" });
      expect(cron.added).toHaveLength(0);
    });

    it("E-M3-A1-04b missing submitted hash → prescription_hash_required", async () => {
      const { result, cron } = await confirm(basePrescription(), {
        enabled: true,
        callerUserId: OWNER,
        prescriptionContentHash: null,
      });
      expect(result).toEqual({ ok: false, reason: "prescription_hash_required" });
      expect(cron.added).toHaveLength(0);
    });

    it("E-M3-A1-05 cross report → cross_report", async () => {
      const { result, cron } = await confirm(basePrescription(), {
        enabled: true,
        callerUserId: OWNER,
        professionalReportId: "pdr-other",
      });
      expect(result).toEqual({ ok: false, reason: "cross_report" });
      expect(cron.added).toHaveLength(0);
    });

    it("E-M3-A1-06 already applied is idempotent already:true", async () => {
      const applied = basePrescription({
        state: "APPLIED",
        confirmable: false,
        appliedJobId: "job-existing",
      });
      applied.confirmReceipt = {
        callerUserId: OWNER,
        confirmedAt: "2026-09-19T11:00:00.000Z",
        prescriptionContentHash: applied.prescriptionContentHash!,
      };
      const cron = cronPort([{ id: "job-existing", name: `diagnosis-evolution:${RX_ID}` }]);
      const { result } = await confirm(applied, {
        enabled: true,
        callerUserId: OWNER,
        cron,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.already).toBe(true);
      expect(result.jobId).toBe("job-existing");
      expect(cron.added).toHaveLength(0);
    });
  });

  describe("E-M3-A2 schedule_diagnosis_prescription proxy path", () => {
    const PROXY = "steward-7";

    it("E-M3-A2-01 approved dedicated grant schedules cron", async () => {
      const rx = basePrescription({ authorizationRef: "grant-proxy-1" });
      const { result, cron, db } = await confirm(rx, {
        enabled: true,
        callerUserId: PROXY,
        grant: proxyGrant(),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.already).toBe(false);
      expect(cron.added).toHaveLength(1);
      expect(db.get(RX_ID)?.confirmReceipt?.callerUserId).toBe(PROXY);
    });

    it("E-M3-A2-02 steward/admin without dedicated grant → authorization_required", async () => {
      const rx = basePrescription({ authorizationRef: null });
      const { result, cron } = await confirm(rx, {
        enabled: true,
        callerUserId: PROXY,
      });
      expect(result).toEqual({ ok: false, reason: "authorization_required" });
      expect(cron.added).toHaveLength(0);
    });

    it("E-M3-A2-03 WDNA evolution-grant → wdna_grant_forbidden", async () => {
      const rx = basePrescription({ authorizationRef: "grant-wdna-1" });
      const { result, cron } = await confirm(rx, {
        enabled: true,
        callerUserId: PROXY,
        grant: proxyGrant({
          purpose: 'evolution-grant:{"surfaceId":"agent.working-dna"}',
          surfaceId: "agent.working-dna",
          allowedActions: ["suggest", "experiment", "inspect"],
        }),
      });
      expect(result).toEqual({ ok: false, reason: "wdna_grant_forbidden" });
      expect(cron.added).toHaveLength(0);
    });

    it("E-M3-A2-04 grant binding mismatch → grant_binding_mismatch", async () => {
      const rx = basePrescription({ authorizationRef: "grant-misbind" });
      const cases: PrescriptionGrantView[] = [
        proxyGrant({ tenantId: "tenant-other" }),
        proxyGrant({ targetPrincipal: "other-owner" }),
        proxyGrant({ targetAgent: "other-agent" }),
      ];
      for (const grant of cases) {
        const { result, cron } = await confirm(rx, {
          enabled: true,
          callerUserId: PROXY,
          grant,
        });
        expect(result).toEqual({ ok: false, reason: "grant_binding_mismatch" });
        expect(cron.added).toHaveLength(0);
      }
    });

    it("E-M3-A2-05 missing schedule_diagnosis_prescription action → authorization_required", async () => {
      const rx = basePrescription({ authorizationRef: "grant-no-action" });
      const { result, cron } = await confirm(rx, {
        enabled: true,
        callerUserId: PROXY,
        grant: proxyGrant({ allowedActions: ["read", "suggest"] }),
      });
      expect(result).toEqual({ ok: false, reason: "authorization_required" });
      expect(cron.added).toHaveLength(0);
    });

    it("E-M3-A2-06 REVOKED/DENIED → revoked", async () => {
      const rx = basePrescription({ authorizationRef: "grant-revoked" });
      for (const status of ["REVOKED", "DENIED"] as const) {
        const db = store(rx);
        const { result, cron } = await confirm(rx, {
          enabled: true,
          callerUserId: PROXY,
          grant: proxyGrant({ status }),
          store: db,
        });
        expect(result).toEqual({ ok: false, reason: "revoked" });
        expect(cron.added).toHaveLength(0);
        expect(db.get(RX_ID)?.state).toBe("REVOKED");
      }
    });

    it("E-M3-A2-07 EXPIRED grant → expired", async () => {
      const rx = basePrescription({ authorizationRef: "grant-expired" });
      const db = store(rx);
      const { result, cron } = await confirm(rx, {
        enabled: true,
        callerUserId: PROXY,
        grant: proxyGrant({ status: "EXPIRED" }),
        store: db,
      });
      expect(result).toEqual({ ok: false, reason: "expired" });
      expect(cron.added).toHaveLength(0);
      expect(db.get(RX_ID)?.state).toBe("EXPIRED");
    });

    it("E-M3-A2-08 non-owner empty authorizationRef → authorization_required", async () => {
      const rx = basePrescription({ authorizationRef: null });
      const { result, cron } = await confirm(rx, {
        enabled: true,
        callerUserId: PROXY,
      });
      expect(result).toEqual({ ok: false, reason: "authorization_required" });
      expect(cron.added).toHaveLength(0);
    });
  });

  it("E-M3 production constant remains true after fixture-enabled cases", () => {
    expect(DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED).toBe(true);
  });
});
