import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { withEnvAsync } from "../test-utils/env.js";
import {
  assertSafeForgetId,
  executeForgetPlan,
  parseForgetScope,
  resolveForgetPlan,
} from "./data-forget.js";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-data-forget-"));
let caseIndex = 0;

afterAll(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function makeCaseDir(): string {
  const dir = path.join(fixtureRoot, `case-${caseIndex++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function seedSessionFixture(stateDir: string): {
  storePath: string;
  transcript: string;
  topicTranscript: string;
  resetArchive: string;
  unrelated: string;
} {
  const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  const storePath = path.join(sessionsDir, "sessions.json");
  fs.writeFileSync(
    storePath,
    JSON.stringify({
      "agent:main:main": { sessionId: "sess-forget-1", updatedAt: 1 },
      "agent:main:other": { sessionId: "sess-keep-2", updatedAt: 2 },
    }),
    "utf-8",
  );
  const transcript = path.join(sessionsDir, "sess-forget-1.jsonl");
  const topicTranscript = path.join(sessionsDir, "sess-forget-1-topic-7.jsonl");
  const resetArchive = path.join(sessionsDir, "sess-forget-1.jsonl.reset.2026-01-01");
  const unrelated = path.join(sessionsDir, "sess-keep-2.jsonl");
  for (const file of [transcript, topicTranscript, resetArchive, unrelated]) {
    fs.writeFileSync(file, "{}\n", "utf-8");
  }
  return { storePath, transcript, topicTranscript, resetArchive, unrelated };
}

describe("parseForgetScope", () => {
  it("accepts the three valid scopes", () => {
    expect(parseForgetScope("session")).toBe("session");
    expect(parseForgetScope(" AGENT ")).toBe("agent");
    expect(parseForgetScope("tenant")).toBe("tenant");
  });

  it("throws on invalid scopes", () => {
    expect(() => parseForgetScope("everything")).toThrow(/invalid --scope/);
    expect(() => parseForgetScope("")).toThrow(/invalid --scope/);
  });
});

describe("assertSafeForgetId", () => {
  it("rejects path traversal ids", () => {
    expect(() => assertSafeForgetId("../etc")).toThrow(/invalid --id/);
    expect(() => assertSafeForgetId("a/b")).toThrow(/invalid --id/);
    expect(() => assertSafeForgetId("a\\b")).toThrow(/invalid --id/);
    expect(() => assertSafeForgetId("a..b")).toThrow(/invalid --id/);
    expect(() => assertSafeForgetId("")).toThrow(/invalid --id/);
  });

  it("accepts session ids and store keys", () => {
    expect(assertSafeForgetId("sess-1")).toBe("sess-1");
    expect(assertSafeForgetId("agent:main:whatsapp:+15550001111")).toBe(
      "agent:main:whatsapp:+15550001111",
    );
  });
});

describe("resolveForgetPlan (session scope)", () => {
  it("enumerates store edits and transcript files without deleting anything", async () => {
    const stateDir = makeCaseDir();
    const fixture = seedSessionFixture(stateDir);
    await withEnvAsync(
      { OPENBOT_STATE_DIR: stateDir, OPENBOT_DATA_MODE: undefined, OPENCLAW_DATA_MODE: undefined },
      async () => {
        const plan = resolveForgetPlan({ cfg: {}, scope: "session", id: "sess-forget-1" });
        expect(plan.storeEdits).toEqual([
          { storePath: fixture.storePath, keys: ["agent:main:main"] },
        ]);
        const planned = plan.targets.map((t) => t.path).toSorted();
        expect(planned).toEqual(
          [fixture.transcript, fixture.topicTranscript, fixture.resetArchive].toSorted(),
        );
      },
    );
    // Dry-run (plan only): every file must still exist.
    for (const file of [
      fixture.storePath,
      fixture.transcript,
      fixture.topicTranscript,
      fixture.resetArchive,
      fixture.unrelated,
    ]) {
      expect(fs.existsSync(file)).toBe(true);
    }
  });

  it("matches by store key as well as session id", async () => {
    const stateDir = makeCaseDir();
    const fixture = seedSessionFixture(stateDir);
    await withEnvAsync(
      { OPENBOT_STATE_DIR: stateDir, OPENBOT_DATA_MODE: undefined, OPENCLAW_DATA_MODE: undefined },
      async () => {
        const plan = resolveForgetPlan({ cfg: {}, scope: "session", id: "agent:main:main" });
        expect(plan.storeEdits).toEqual([
          { storePath: fixture.storePath, keys: ["agent:main:main"] },
        ]);
      },
    );
  });

  it("returns an empty plan when nothing matches", async () => {
    const stateDir = makeCaseDir();
    seedSessionFixture(stateDir);
    await withEnvAsync(
      { OPENBOT_STATE_DIR: stateDir, OPENBOT_DATA_MODE: undefined, OPENCLAW_DATA_MODE: undefined },
      async () => {
        const plan = resolveForgetPlan({ cfg: {}, scope: "session", id: "sess-unknown" });
        expect(plan.storeEdits).toEqual([]);
        expect(plan.targets).toEqual([]);
      },
    );
  });

  it("fails closed when data.mode=managed", async () => {
    const stateDir = makeCaseDir();
    seedSessionFixture(stateDir);
    await withEnvAsync(
      { OPENBOT_STATE_DIR: stateDir, OPENBOT_DATA_MODE: undefined, OPENCLAW_DATA_MODE: undefined },
      async () => {
        expect(() =>
          resolveForgetPlan({
            cfg: { data: { mode: "managed" } },
            scope: "session",
            id: "sess-forget-1",
          }),
        ).toThrow(/fail-closed/);
      },
    );
  });
});

describe("executeForgetPlan (session scope)", () => {
  it("removes the store entry and deletes only the matched transcripts", async () => {
    const stateDir = makeCaseDir();
    const fixture = seedSessionFixture(stateDir);
    await withEnvAsync(
      { OPENBOT_STATE_DIR: stateDir, OPENBOT_DATA_MODE: undefined, OPENCLAW_DATA_MODE: undefined },
      async () => {
        const plan = resolveForgetPlan({ cfg: {}, scope: "session", id: "sess-forget-1" });
        const report = await executeForgetPlan(plan);
        expect(report.failed).toEqual([]);
        expect(report.removedStoreKeys).toEqual([
          { storePath: fixture.storePath, keys: ["agent:main:main"] },
        ]);
        expect(report.deleted.toSorted()).toEqual(
          [fixture.transcript, fixture.topicTranscript, fixture.resetArchive].toSorted(),
        );
      },
    );

    const store = JSON.parse(fs.readFileSync(fixture.storePath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(store)).toEqual(["agent:main:other"]);
    expect(fs.existsSync(fixture.transcript)).toBe(false);
    expect(fs.existsSync(fixture.topicTranscript)).toBe(false);
    expect(fs.existsSync(fixture.resetArchive)).toBe(false);
    expect(fs.existsSync(fixture.unrelated)).toBe(true);
  });
});

describe("agent scope", () => {
  it("targets the agent sessions dir and Data Space dir, and deletes them with --yes", async () => {
    const stateDir = makeCaseDir();
    const dataRoot = makeCaseDir();
    const sessionsDir = path.join(stateDir, "agents", "worker", "sessions");
    const agentDataDir = path.join(dataRoot, "agents", "worker");
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.mkdirSync(path.join(agentDataDir, "memory"), { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(agentDataDir, "memory", "agent.sqlite"), "sqlite", "utf-8");
    // Credentials dir must survive agent forget.
    const credsDir = path.join(stateDir, "agents", "worker", "agent");
    fs.mkdirSync(credsDir, { recursive: true });

    await withEnvAsync(
      { OPENBOT_STATE_DIR: stateDir, OPENBOT_DATA_MODE: undefined, OPENCLAW_DATA_MODE: undefined },
      async () => {
        const cfg = { data: { root: dataRoot } };
        const plan = resolveForgetPlan({ cfg, scope: "agent", id: "worker" });
        expect(plan.targets.map((t) => t.path).toSorted()).toEqual(
          [sessionsDir, agentDataDir].toSorted(),
        );

        const report = await executeForgetPlan(plan);
        expect(report.failed).toEqual([]);
        expect(report.deleted.toSorted()).toEqual([sessionsDir, agentDataDir].toSorted());
      },
    );

    expect(fs.existsSync(sessionsDir)).toBe(false);
    expect(fs.existsSync(agentDataDir)).toBe(false);
    expect(fs.existsSync(credsDir)).toBe(true);
  });

  it("fails closed when data.mode=managed", async () => {
    await withEnvAsync(
      { OPENBOT_DATA_MODE: "managed", OPENCLAW_DATA_MODE: undefined },
      async () => {
        expect(() => resolveForgetPlan({ cfg: {}, scope: "agent", id: "worker" })).toThrow(
          /fail-closed/,
        );
      },
    );
  });
});

describe("tenant scope", () => {
  it("rejects unsafe tenant ids", async () => {
    const tenantsRoot = makeCaseDir();
    await withEnvAsync({ OPENBOT_TENANTS_ROOT: tenantsRoot }, async () => {
      expect(() => resolveForgetPlan({ cfg: {}, scope: "tenant", id: ".hidden" })).toThrow(
        /invalid tenant id/,
      );
    });
  });

  it("deletes the tenant live root under the tenants root", async () => {
    const tenantsRoot = makeCaseDir();
    const liveRoot = path.join(tenantsRoot, "acme");
    fs.mkdirSync(path.join(liveRoot, "control-plane"), { recursive: true });
    fs.writeFileSync(path.join(liveRoot, "control-plane", "seat-assets.json"), "{}", "utf-8");

    await withEnvAsync({ OPENBOT_TENANTS_ROOT: tenantsRoot }, async () => {
      const plan = resolveForgetPlan({ cfg: {}, scope: "tenant", id: "acme" });
      expect(plan.targets).toHaveLength(1);
      expect(plan.targets[0]?.path).toBe(liveRoot);
      const report = await executeForgetPlan(plan);
      expect(report.failed).toEqual([]);
      expect(report.deleted).toEqual([liveRoot]);
    });

    expect(fs.existsSync(liveRoot)).toBe(false);
    expect(fs.existsSync(tenantsRoot)).toBe(true);
  });

  it("reports a missing tenant root as a skip", async () => {
    const tenantsRoot = makeCaseDir();
    await withEnvAsync({ OPENBOT_TENANTS_ROOT: tenantsRoot }, async () => {
      const plan = resolveForgetPlan({ cfg: {}, scope: "tenant", id: "ghost" });
      expect(plan.targets[0]?.exists).toBe(false);
      const report = await executeForgetPlan(plan);
      expect(report.skipped).toEqual([path.join(tenantsRoot, "ghost")]);
      expect(report.deleted).toEqual([]);
    });
  });
});
