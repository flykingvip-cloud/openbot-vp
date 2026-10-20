import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OBJECTIVE_SHADOW_FLAG_ENV,
  OBJECTIVE_SHADOW_HMAC_KEY_ENV,
  isObjectiveShadowEnabled,
} from "./feature.js";
import { readShadowRecords } from "./log.js";
import { deriveWorkUnitId, validateProposedWorkUnits } from "./observe.js";
import { hmacHash16 } from "./redact.js";
import { replayObserve, stableReplayHash } from "./replay.js";
import { maybeObserveObjectiveShadow, tryObserveObjectiveShadow } from "./runtime.js";
import type { ProposedWorkUnitDefinition, ShadowObserveInput } from "./types.js";
import { OBJECTIVE_SHADOW_SCHEMA } from "./types.js";
import { SHADOW_WINDOW_MS, SHADOW_WINDOW_N, writeWindowState } from "./window.js";
import { createForbiddenWriteGuard } from "./write-guard.js";

const HMAC_KEY = "test-hmac-key-objective-shadow";
const TENANT = "tenant-secret-acme";
const GROUP = "group-secret-99";

let root: string;
let logPath: string;
let windowPath: string;
let guard: ReturnType<typeof createForbiddenWriteGuard>;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "objective-shadow-"));
  logPath = path.join(root, "objective-shadow.jsonl");
  windowPath = path.join(root, "objective-shadow.window.json");
  guard = createForbiddenWriteGuard();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function input(over: Partial<ShadowObserveInput> = {}): ShadowObserveInput {
  return {
    schemaVersion: OBJECTIVE_SHADOW_SCHEMA,
    tenantId: TENANT,
    ingress: "chat",
    runId: "run-1",
    candidates: [{ source: "conversation_task", objectiveId: "obj-1", revision: 3 }],
    observedAtMs: 1_700_000_000_000,
    ...over,
  };
}

function deps(env: NodeJS.ProcessEnv, extra: { nowMs?: () => number; replay?: boolean } = {}) {
  return {
    env,
    logPath,
    windowPath,
    writeGuard: guard,
    nowMs: extra.nowMs ?? (() => 1_700_000_000_000),
    replay: extra.replay,
  };
}

describe("OFF 零副作用", () => {
  it("defaults OFF when env is unset", () => {
    expect(isObjectiveShadowEnabled({})).toBe(false);
    expect(isObjectiveShadowEnabled({ [OBJECTIVE_SHADOW_FLAG_ENV]: "" })).toBe(false);
    expect(isObjectiveShadowEnabled({ [OBJECTIVE_SHADOW_FLAG_ENV]: "0" })).toBe(false);
    expect(isObjectiveShadowEnabled({ [OBJECTIVE_SHADOW_FLAG_ENV]: "false" })).toBe(false);
  });

  it("does not write JSONL, coordination objects, or increment the write guard", () => {
    const result = maybeObserveObjectiveShadow(
      input(),
      deps({ [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: HMAC_KEY }),
    );
    expect(result).toEqual({ enabled: false, wrote: false });
    expect(fs.existsSync(logPath)).toBe(false);
    expect(fs.existsSync(windowPath)).toBe(false);
    expect(guard.attempts).toBe(0);
    expect(fs.readdirSync(root)).toEqual([]);
  });
});

describe("ON 单条日志", () => {
  it("writes exactly one redacted JSONL record and no forbidden writes", () => {
    const env = {
      [OBJECTIVE_SHADOW_FLAG_ENV]: "1",
      [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: HMAC_KEY,
    };
    const result = maybeObserveObjectiveShadow(input(), deps(env));
    expect(result.enabled).toBe(true);
    expect(result.wrote).toBe(true);
    expect(result.record?.proposedDisposition).toBe("generated");
    expect(result.record?.proposed).toHaveLength(1);
    expect(result.record?.proposed[0]?.definitionEpoch).toBe(0);
    expect(result.record?.proposed[0]?.coversWorkUnitIds).toEqual([]);
    expect(result.record?.proposed[0]?.workUnitId).toBe(deriveWorkUnitId("obj-1", 3, "run-1"));
    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(guard.attempts).toBe(0);
  });
});

describe("缺 HMAC key fail-closed", () => {
  it("does not write when flag is ON but HMAC key is missing", () => {
    const result = maybeObserveObjectiveShadow(
      input(),
      deps({ [OBJECTIVE_SHADOW_FLAG_ENV]: "true" }),
    );
    expect(result).toEqual({ enabled: true, wrote: false, reason: "hmac_key_missing" });
    expect(fs.existsSync(logPath)).toBe(false);
    expect(guard.attempts).toBe(0);
  });
});

describe("禁止写入探测", () => {
  it("stays at zero forbidden-write attempts on the ON path", () => {
    maybeObserveObjectiveShadow(
      input(),
      deps({
        [OBJECTIVE_SHADOW_FLAG_ENV]: "1",
        [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: HMAC_KEY,
      }),
    );
    expect(guard.attempts).toBe(0);
  });

  it("stops further JSONL writes after a forbidden-write probe", () => {
    const env = {
      [OBJECTIVE_SHADOW_FLAG_ENV]: "1",
      [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: HMAC_KEY,
    };
    maybeObserveObjectiveShadow(input({ runId: "run-ok" }), deps(env));
    expect(readShadowRecords(logPath)).toHaveLength(1);
    guard.record("claimWorkUnit");
    const blocked = maybeObserveObjectiveShadow(input({ runId: "run-blocked" }), deps(env));
    expect(blocked.wrote).toBe(false);
    expect(blocked.reason).toBe("stopped");
    expect(readShadowRecords(logPath)).toHaveLength(1);
  });
});

describe("同一 runId 幂等", () => {
  it("does not append a second line for the same runId", () => {
    const env = {
      [OBJECTIVE_SHADOW_FLAG_ENV]: "1",
      [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: HMAC_KEY,
    };
    const first = maybeObserveObjectiveShadow(input(), deps(env));
    const second = maybeObserveObjectiveShadow(input(), deps(env));
    expect(first.wrote).toBe(true);
    expect(second.wrote).toBe(false);
    expect(second.reason).toBe("idempotent");
    expect(readShadowRecords(logPath)).toHaveLength(1);
  });
});

describe("7 天/N=500 窗口关闭", () => {
  it("does not write after N=500 records for the ingress", () => {
    writeWindowState(windowPath, {
      firstWriteAtMs: 1_700_000_000_000,
      counts: { chat: SHADOW_WINDOW_N },
      seenRunIds: [],
      stopped: false,
    });
    const result = maybeObserveObjectiveShadow(
      input({ runId: "run-after-n" }),
      deps({
        [OBJECTIVE_SHADOW_FLAG_ENV]: "1",
        [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: HMAC_KEY,
      }),
    );
    expect(result.wrote).toBe(false);
    expect(result.reason).toBe("window_closed");
    expect(result.record?.rejectOrDiscardCodes).toContain("window_closed");
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it("does not write after the 7-day wall clock window", () => {
    const start = 1_700_000_000_000;
    writeWindowState(windowPath, {
      firstWriteAtMs: start,
      counts: { chat: 1 },
      seenRunIds: ["run-old"],
      stopped: false,
    });
    const result = maybeObserveObjectiveShadow(
      input({ runId: "run-after-7d" }),
      deps(
        {
          [OBJECTIVE_SHADOW_FLAG_ENV]: "1",
          [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: HMAC_KEY,
        },
        { nowMs: () => start + SHADOW_WINDOW_MS },
      ),
    );
    expect(result.wrote).toBe(false);
    expect(result.reason).toBe("window_closed");
  });
});

describe("replay 稳定哈希", () => {
  it("replays observe without writing JSONL and keeps a stable hash", () => {
    const env = {
      [OBJECTIVE_SHADOW_FLAG_ENV]: "1",
      [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: HMAC_KEY,
    };
    const ctx = {
      tenantHash: hmacHash16(TENANT, HMAC_KEY),
      nowMs: 1_700_000_000_000,
    };
    const a = replayObserve(input(), ctx);
    const b = replayObserve(input(), ctx);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(stableReplayHash(a.record));
    const replayed = maybeObserveObjectiveShadow(input({ runId: "run-replay" }), {
      ...deps(env, { replay: true }),
    });
    expect(replayed.wrote).toBe(false);
    expect(replayed.reason).toBe("replay");
    expect(fs.existsSync(logPath)).toBe(false);
  });
});

describe("日志脱敏与无明文泄漏", () => {
  it("never persists tenantId, groupId, or sensitive candidate metadata", () => {
    const env = {
      [OBJECTIVE_SHADOW_FLAG_ENV]: "1",
      [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: HMAC_KEY,
    };
    const dirty = input({
      groupId: GROUP,
      candidates: [
        {
          source: "conversation_task",
          objectiveId: "obj-1",
          revision: 3,
          email: "alice@example.com",
          phone: "+15551234567",
          token: "sk-live-secret",
          path: "/Users/daniel/secret",
        } as unknown as ShadowObserveInput["candidates"][number],
      ],
    });
    const result = maybeObserveObjectiveShadow(dirty, deps(env));
    expect(result.wrote).toBe(true);
    const raw = fs.readFileSync(logPath, "utf8");
    expect(raw).not.toContain(TENANT);
    expect(raw).not.toContain(GROUP);
    expect(raw).not.toContain("alice@example.com");
    expect(raw).not.toContain("+15551234567");
    expect(raw).not.toContain("sk-live-secret");
    expect(raw).not.toContain("/Users/daniel/secret");
    expect(raw).toContain(hmacHash16(TENANT, HMAC_KEY));
    expect(raw).toContain(hmacHash16(GROUP, HMAC_KEY));
    expect(result.record?.conflictCodes).toContain("redaction_dropped");
  });
});

describe("resolver rules", () => {
  const env = () => ({
    [OBJECTIVE_SHADOW_FLAG_ENV]: "1",
    [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: HMAC_KEY,
  });

  it("discards collaboration proposed units (not Phase 3b)", () => {
    const result = maybeObserveObjectiveShadow(
      input({
        ingress: "collaboration_turn",
        groupId: GROUP,
        candidates: [{ source: "collaboration", objectiveId: "obj-1", revision: 3 }],
      }),
      deps(env()),
    );
    expect(result.record?.proposed).toEqual([]);
    expect(result.record?.proposedDisposition).toBe("discarded");
    expect(result.record?.rejectOrDiscardCodes).toContain("collab_deferred_phase3b");
  });

  it("rejects execute units that carry coversWorkUnitIds (I25)", () => {
    const bad: ProposedWorkUnitDefinition = {
      workUnitId: "wu",
      objectiveId: "obj-1",
      objectiveRevision: 3,
      coordinationPolicy: "exclusive",
      contributionKind: "execute",
      required: true,
      acceptanceIds: [],
      dependsOnWorkUnitIds: [],
      coversWorkUnitIds: ["other"],
      minContributors: 1,
      maxContributors: 1,
      createdByKind: "runtime",
      definitionEpoch: 0,
    };
    expect(validateProposedWorkUnits([bad], "chat")).toContain("i25_execute_covers_not_empty");
  });

  it("subagent without an observed parent run snapshot records inherit_violation", () => {
    const result = maybeObserveObjectiveShadow(
      input({
        ingress: "subagent",
        runId: "child-run",
        parentRunId: undefined,
        candidates: [],
      }),
      deps(env()),
    );
    expect(result.record?.conflictCodes).toContain("inherit_violation");
    expect(result.record?.proposed).toEqual([]);
    expect(result.record?.correlation.objectiveId).toBeUndefined();
  });

  it("empty or incomplete candidates skip and do not propose a WorkUnitDefinition", () => {
    const cases: Array<Partial<ShadowObserveInput>> = [
      { runId: "run-empty", candidates: [] },
      { runId: "run-missing-id", candidates: [{ source: "conversation_task", revision: 2 }] },
      {
        runId: "run-missing-rev",
        candidates: [{ source: "conversation_task", objectiveId: "obj-only" }],
      },
    ];
    for (const over of cases) {
      const result = maybeObserveObjectiveShadow(input(over), deps(env()));
      expect(result.record?.resolveStatus).toBe("skipped");
      expect(result.record?.proposed).toEqual([]);
      expect(result.record?.correlation.objectiveId).toBeUndefined();
      expect(result.record?.correlation.objectiveId).not.toBe(over.runId);
      expect(result.record?.proposedDisposition).not.toBe("generated");
    }
  });

  it("does not throw from the fire-and-forget hook", () => {
    expect(() =>
      tryObserveObjectiveShadow(input(), {
        env: env(),
        logPath: path.join(root, "nested", "shadow.jsonl"),
        windowPath: path.join(root, "nested", "shadow.window.json"),
        writeGuard: guard,
        nowMs: () => 1,
      }),
    ).not.toThrow();
  });
});
