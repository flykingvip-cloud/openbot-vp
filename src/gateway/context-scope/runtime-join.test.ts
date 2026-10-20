import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createPersistedRound,
  readPersistedRound,
  writePersistedRound,
} from "../collaboration-dispatch/round-store.js";
import { resolveContextScopePlan } from "./controller.js";
import {
  persistAuthorizedContextScopePlan,
  recordContextScopeOnCollaborationRuntime,
} from "./runtime-join.js";

vi.mock("../collaboration-ledger/writer.js", () => ({
  appendCollaborationContextScopeRecord: vi.fn().mockResolvedValue({}),
}));

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function retrievePlan() {
  return resolveContextScopePlan({
    inboundDepth: "retrieve",
    sessionKey: "space:alpha",
    groupId: "alpha",
    request: { mode: "focused", sources: [{ type: "file", fileId: "notes.md" }] },
  });
}

async function openRound(roundsDir: string) {
  const created = createPersistedRound({
    roundId: "round-scope",
    groupId: "alpha",
    sessionKey: "space:alpha",
    userMessageId: "msg-1",
    collaborationMode: "lead_plus_supplement",
    policyVersion: "1.0",
    policyHash: "abc",
    policySnapshot: {},
    state: "PRIMARY_RESPONDING",
    primaryMode: "single",
    mentionMode: "none",
    primaryQueue: ["bot-a"],
    primaryCursor: 0,
  });
  await writePersistedRound({ round: created, roundsDir });
  return created;
}

describe("context scope runtime join", () => {
  test("writes the authorized plan onto the open round snapshot", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-scope-join-"));
    tmpDirs.push(roundsDir);
    const created = await openRound(roundsDir);
    const written = await persistAuthorizedContextScopePlan({
      groupId: "alpha",
      sessionKey: "space:alpha",
      plan: retrievePlan(),
      roundsDir,
    });
    expect(written).toBe(true);
    const loaded = await readPersistedRound({
      groupId: "alpha",
      roundId: "round-scope",
      roundsDir,
    });
    expect(loaded?.contextScopePlan).toMatchObject({ mode: "focused" });
    expect(loaded?.stateVersion).toBe(created.stateVersion);
  });

  test("managed join without an open round stays retrieve-eligible", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-scope-join-"));
    tmpDirs.push(roundsDir);
    const join = await recordContextScopeOnCollaborationRuntime({
      groupId: "alpha",
      sessionKey: "space:alpha",
      plan: retrievePlan(),
      evidenceCount: 0,
      roundsDir,
      requireSnapshot: true,
    });
    expect(join).toMatchObject({
      ledger: true,
      snapshot: false,
      degraded: false,
      reason: "no_open_round",
    });
  });

  test("matches agent space session keys onto space-scoped open rounds", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-scope-join-"));
    tmpDirs.push(roundsDir);
    await openRound(roundsDir);
    const written = await persistAuthorizedContextScopePlan({
      groupId: "alpha",
      sessionKey: "agent:bot-2:main:space:alpha",
      plan: retrievePlan(),
      roundsDir,
    });
    expect(written).toBe(true);
    const join = await recordContextScopeOnCollaborationRuntime({
      groupId: "alpha",
      sessionKey: "agent:bot-2:main:space:alpha",
      plan: retrievePlan(),
      evidenceCount: 0,
      roundsDir,
      requireSnapshot: true,
    });
    expect(join).toEqual({ ledger: true, snapshot: true, degraded: false });
  });

  test("managed join writes snapshot before retrieve is allowed", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-scope-join-"));
    tmpDirs.push(roundsDir);
    await openRound(roundsDir);
    const join = await recordContextScopeOnCollaborationRuntime({
      groupId: "alpha",
      sessionKey: "space:alpha",
      plan: retrievePlan(),
      evidenceCount: 0,
      roundsDir,
      requireSnapshot: true,
    });
    expect(join).toEqual({ ledger: true, snapshot: true, degraded: false });
  });

  test("managed snapshot write failure marks scope_persistence_degraded", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-scope-join-"));
    tmpDirs.push(roundsDir);
    await openRound(roundsDir);
    await fs.rm(roundsDir, { recursive: true, force: true });
    await fs.writeFile(roundsDir, "not-a-directory");
    const join = await recordContextScopeOnCollaborationRuntime({
      groupId: "alpha",
      sessionKey: "space:alpha",
      plan: retrievePlan(),
      evidenceCount: 0,
      roundsDir,
      requireSnapshot: true,
    });
    expect(join.degraded).toBe(true);
    expect(join.snapshot).toBe(false);
    expect(join.reason).toBe("snapshot_failed");
  });
});
