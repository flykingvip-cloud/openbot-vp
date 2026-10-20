import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCAL_UNSCOPED_TENANT_ID } from "./candidates.js";
import { cronCandidatesFromJob } from "./cron-objective.js";
import { OBJECTIVE_SHADOW_FLAG_ENV, OBJECTIVE_SHADOW_HMAC_KEY_ENV } from "./feature.js";
import { OBJECTIVE_SHADOW_LOG_ENV, observeObjectiveShadowFromIngress } from "./ingress-hook.js";
import { readShadowRecords } from "./log.js";
import { hmacHash16 } from "./redact.js";
import { FORBIDDEN_WRITE_SYMBOLS } from "./write-guard.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HMAC_KEY = "wiring-hmac-key";

const WIRED_FILES = [
  "src/auto-reply/reply/get-reply-run.ts",
  "src/cron/isolated-agent/run.ts",
  "src/gateway/collaboration-dispatch/round-runtime.ts",
  "src/agents/subagent-spawn.ts",
] as const;

const FORBIDDEN_CALLS = [
  ...FORBIDDEN_WRITE_SYMBOLS,
  "writeLedger",
  "appendContribution",
  "upsertActiveLeasePointer",
];

let root: string;
let logPath: string;
let previous: Record<string, string | undefined> = {};

function snapshotEnv(keys: string[]) {
  previous = {};
  for (const key of keys) {
    previous[key] = process.env[key];
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "objective-shadow-wire-"));
  logPath = path.join(root, "objective-shadow.jsonl");
  snapshotEnv([OBJECTIVE_SHADOW_FLAG_ENV, OBJECTIVE_SHADOW_HMAC_KEY_ENV, OBJECTIVE_SHADOW_LOG_ENV]);
  process.env[OBJECTIVE_SHADOW_LOG_ENV] = logPath;
  delete process.env[OBJECTIVE_SHADOW_FLAG_ENV];
  delete process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV];
});

afterEach(() => {
  restoreEnv();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("ingress wiring sources", () => {
  it("calls observeObjectiveShadowFromIngress from each required ingress", () => {
    for (const rel of WIRED_FILES) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      expect(text).toContain("observeObjectiveShadowFromIngress");
    }
  });

  it("does not fabricate candidates from runId in the adapter or call sites", () => {
    const hook = fs.readFileSync(
      path.join(REPO_ROOT, "src/objective-shadow/ingress-hook.ts"),
      "utf8",
    );
    expect(hook).not.toContain("defaultCandidates");
    expect(hook).not.toMatch(/objectiveId:\s*runId/);
    for (const rel of WIRED_FILES) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      expect(text).toMatch(/candidates:/);
    }
  });

  it("wired files do not import or call Lease/Pointer/Contribution/Ledger writers", () => {
    const hits: string[] = [];
    for (const rel of WIRED_FILES) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      const imports = text
        .split("\n")
        .filter((line) => /^\s*import\b/.test(line))
        .join("\n");
      for (const needle of FORBIDDEN_CALLS) {
        if (imports.includes(needle) || new RegExp(`\\b${needle}\\s*\\(`).test(text)) {
          hits.push(`${rel}:${needle}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("ingress hook contract", () => {
  it("flag OFF writes no JSONL for any ingress", () => {
    for (const ingress of ["chat", "cron_isolated", "collaboration_turn", "subagent"] as const) {
      observeObjectiveShadowFromIngress({
        ingress,
        tenantId: "tenant-a",
        tenantScope: "identified",
        runId: `run-${ingress}`,
        cronOccurrenceId: ingress === "cron_isolated" ? "occ-1" : undefined,
        cronJobId: ingress === "cron_isolated" ? "job-permanent" : undefined,
        parentRunId: ingress === "subagent" ? "parent-run-1" : undefined,
        groupId: ingress === "collaboration_turn" ? "group-1" : undefined,
        candidates:
          ingress === "subagent"
            ? []
            : [{ source: "inbound_turn", objectiveId: "obj-real", revision: 2 }],
      });
    }
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it("flag ON writes at most one record per runId", () => {
    process.env[OBJECTIVE_SHADOW_FLAG_ENV] = "1";
    process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV] = HMAC_KEY;
    const candidate = {
      source: "conversation_task" as const,
      objectiveId: "obj-once",
      revision: 4,
    };
    observeObjectiveShadowFromIngress({
      ingress: "chat",
      tenantId: "tenant-a",
      tenantScope: "identified",
      runId: "run-once",
      candidates: [candidate],
    });
    observeObjectiveShadowFromIngress({
      ingress: "chat",
      tenantId: "tenant-a",
      tenantScope: "identified",
      runId: "run-once",
      candidates: [candidate],
    });
    expect(readShadowRecords(logPath)).toHaveLength(1);
  });

  it("records objectiveId/revision from the input candidate, not runId", () => {
    process.env[OBJECTIVE_SHADOW_FLAG_ENV] = "1";
    process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV] = HMAC_KEY;
    for (const ingress of ["chat", "cron_isolated"] as const) {
      const runId = `run-${ingress}`;
      observeObjectiveShadowFromIngress({
        ingress,
        tenantId: "tenant-a",
        tenantScope: "identified",
        runId,
        cronOccurrenceId: ingress === "cron_isolated" ? "occ-real" : undefined,
        cronJobId: "job-permanent",
        candidates: [
          {
            source: ingress === "cron_isolated" ? "cron" : "conversation_task",
            objectiveId: `obj-${ingress}`,
            revision: 9,
          },
        ],
      });
      const record = readShadowRecords(logPath).at(-1);
      expect(record?.correlation.objectiveId).toBe(`obj-${ingress}`);
      expect(record?.correlation.revision).toBe(9);
      expect(record?.correlation.objectiveId).not.toBe(runId);
      expect(record?.proposed[0]?.objectiveId).toBe(`obj-${ingress}`);
      expect(record?.proposed[0]?.objectiveRevision).toBe(9);
    }
  });

  it("cron uses occurrence identity, not permanent jobId", () => {
    process.env[OBJECTIVE_SHADOW_FLAG_ENV] = "1";
    process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV] = HMAC_KEY;
    observeObjectiveShadowFromIngress({
      ingress: "cron_isolated",
      tenantId: "tenant-a",
      tenantScope: "identified",
      runId: "job-permanent",
      cronOccurrenceId: "occ-tick-9",
      cronJobId: "job-permanent",
      candidates: [{ source: "cron", objectiveId: "cron-obj-9", revision: 2 }],
    });
    const [record] = readShadowRecords(logPath);
    expect(record.correlation.runId).toBe("occ-tick-9");
    expect(record.correlation.cronOccurrenceId).toBe("occ-tick-9");
    expect(record.correlation.objectiveId).toBe("cron-obj-9");
    expect(JSON.stringify(record.correlation)).not.toContain("job-permanent");
  });

  it("cron with only a permanent jobId and no occurrence writes nothing", () => {
    process.env[OBJECTIVE_SHADOW_FLAG_ENV] = "1";
    process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV] = HMAC_KEY;
    observeObjectiveShadowFromIngress({
      ingress: "cron_isolated",
      tenantId: "tenant-a",
      tenantScope: "identified",
      runId: "job-permanent",
      cronJobId: "job-permanent",
      candidates: [{ source: "cron", objectiveId: "cron-obj-9", revision: 2 }],
    });
    expect(readShadowRecords(logPath)).toEqual([]);
  });

  it("empty or incomplete candidates do not generate a proposed WorkUnitDefinition", () => {
    process.env[OBJECTIVE_SHADOW_FLAG_ENV] = "1";
    process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV] = HMAC_KEY;
    observeObjectiveShadowFromIngress({
      ingress: "chat",
      tenantId: "tenant-a",
      tenantScope: "identified",
      runId: "run-empty",
      candidates: [],
    });
    observeObjectiveShadowFromIngress({
      ingress: "chat",
      tenantId: "tenant-a",
      tenantScope: "identified",
      runId: "run-missing-id",
      candidates: [{ source: "conversation_task", revision: 1 }],
    });
    observeObjectiveShadowFromIngress({
      ingress: "chat",
      tenantId: "tenant-a",
      tenantScope: "identified",
      runId: "run-missing-rev",
      candidates: [{ source: "conversation_task", objectiveId: "obj-only" }],
    });
    const records = readShadowRecords(logPath);
    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(record.proposed).toEqual([]);
      expect(record.correlation.objectiveId).toBeUndefined();
      expect(record.correlation.objectiveId).not.toBe(record.correlation.runId);
      expect(record.resolveStatus).toBe("skipped");
    }
  });

  it("collaboration does not generate a single-chat exclusive proposed unit", () => {
    process.env[OBJECTIVE_SHADOW_FLAG_ENV] = "1";
    process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV] = HMAC_KEY;
    observeObjectiveShadowFromIngress({
      ingress: "collaboration_turn",
      tenantId: "tenant-a",
      tenantScope: "identified",
      runId: "round-1",
      groupId: "group-1",
      candidates: [{ source: "collaboration", objectiveId: "conv_shared", revision: 3 }],
    });
    const [record] = readShadowRecords(logPath);
    expect(record.proposed).toEqual([]);
    expect(record.proposedDisposition).toBe("discarded");
    expect(record.rejectOrDiscardCodes).toContain("collab_deferred_phase3b");
    expect(record.correlation.objectiveId).toBe("conv_shared");
    expect(record.correlation.objectiveId).not.toBe("round-1");
  });

  it("subagent without a real parent run id records inherit_violation", () => {
    process.env[OBJECTIVE_SHADOW_FLAG_ENV] = "1";
    process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV] = HMAC_KEY;
    observeObjectiveShadowFromIngress({
      ingress: "subagent",
      tenantId: "tenant-a",
      tenantScope: "identified",
      runId: "child-1",
      parentRunId: "agent:main:main",
      candidates: [],
    });
    const [record] = readShadowRecords(logPath);
    expect(record.conflictCodes).toContain("inherit_violation");
    expect(record.metrics.inheritViolation).toBe(1);
    expect(record.correlation.parentRunId).toBeUndefined();
    expect(record.proposed).toEqual([]);
  });

  it("identified tenant missing is invalid_input and is not folded into local", () => {
    process.env[OBJECTIVE_SHADOW_FLAG_ENV] = "1";
    process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV] = HMAC_KEY;
    observeObjectiveShadowFromIngress({
      ingress: "chat",
      tenantScope: "identified",
      runId: "run-no-tenant",
      candidates: [{ source: "conversation_task", objectiveId: "obj-x", revision: 1 }],
    });
    const [record] = readShadowRecords(logPath);
    expect(record.conflictCodes).toContain("invalid_input");
    expect(record.proposed).toEqual([]);
    expect(record.correlation.tenantHash).not.toBe(hmacHash16(LOCAL_UNSCOPED_TENANT_ID, HMAC_KEY));
  });

  it("local_unscoped may use the documented local tenant", () => {
    process.env[OBJECTIVE_SHADOW_FLAG_ENV] = "1";
    process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV] = HMAC_KEY;
    observeObjectiveShadowFromIngress({
      ingress: "chat",
      tenantScope: "local_unscoped",
      runId: "run-local",
      candidates: [{ source: "inbound_turn", objectiveId: "obj-local", revision: 1 }],
    });
    const [record] = readShadowRecords(logPath);
    expect(record.conflictCodes).not.toContain("invalid_input");
    expect(record.correlation.tenantHash).toBe(hmacHash16(LOCAL_UNSCOPED_TENANT_ID, HMAC_KEY));
    expect(record.correlation.objectiveId).toBe("obj-local");
  });
});

describe("cron structured meta", () => {
  it("derives objective from job identity and does not write goal/intent text", () => {
    const description = `日报\n<!--openbot-task-meta:${encodeURIComponent(
      JSON.stringify({
        intentText: "secret-goal",
        goal: "secret-goal",
        dataBindings: [
          {
            bindingId: "runtime-today",
            kind: "runtime_date",
            resourceId: "today",
            label: "今天日期",
          },
        ],
        notify: { inApp: true },
      }),
    )}-->`;
    const candidates = cronCandidatesFromJob({
      id: "job-permanent",
      sessionTarget: "isolated",
      schedule: { kind: "cron", expr: "0 9 * * *" },
      payload: { kind: "agentTurn" },
      description,
    });
    expect(candidates[0]?.source).toBe("cron");
    expect(candidates[0]?.objectiveId).toBe("cron-obj:job-permanent");
    expect(candidates[0]?.objectiveId).not.toBe("job-permanent");
    expect(typeof candidates[0]?.revision).toBe("number");
    expect(JSON.stringify(candidates)).not.toContain("secret-goal");
  });
});
