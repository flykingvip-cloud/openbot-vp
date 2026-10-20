import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCogniWeaveWritesAllowed,
  CogniWeaveWriteFrozenError,
  ensurePortableCanonicalStoreWithFsm,
  isCogniWeaveCanonicalWriteFrozen,
  readCogniWeaveMigrationState,
  switchBackPortableCanonicalStore,
  writeCogniWeaveMigrationState,
} from "./cogniweave-migration.js";
import {
  resolveLegacyCogniWeaveStorePath,
  resolvePortableCanonicalStorePath,
} from "./data-space.js";

describe("cogniweave migration FSM (CW2-P1-02c)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function scratch(): { root: string; stateDir: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-mig-root-"));
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-mig-state-"));
    dirs.push(root, stateDir);
    return { root, stateDir };
  }

  it("runs durable phases to completed and keeps legacy backup", () => {
    const { root, stateDir } = scratch();
    const legacy = resolveLegacyCogniWeaveStorePath(stateDir);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, "canonical-v1-bytes");

    const result = ensurePortableCanonicalStoreWithFsm({ dataRoot: root, stateDir });
    expect(result.cutoverFromLegacy).toBe(true);
    expect(result.storePath).toBe(resolvePortableCanonicalStorePath(root));
    expect(fs.readFileSync(result.storePath, "utf-8")).toBe("canonical-v1-bytes");
    expect(fs.existsSync(legacy)).toBe(true);
    expect(result.migrationState?.phase).toBe("completed");
    expect(result.migrationState?.history.map((h) => h.to)).toEqual(
      expect.arrayContaining([
        "planned",
        "freeze_writes",
        "snapshot_copy",
        "integrity_check",
        "cutover_switched",
        "completed",
      ]),
    );
    expect(isCogniWeaveCanonicalWriteFrozen(root)).toBe(false);
  });

  it("rolls back pre-cutover crash and keeps legacy authority", () => {
    const { root, stateDir } = scratch();
    const legacy = resolveLegacyCogniWeaveStorePath(stateDir);
    const portable = resolvePortableCanonicalStorePath(root);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, "authority-bytes");
    fs.mkdirSync(path.dirname(portable), { recursive: true });
    fs.writeFileSync(`${portable}.partial`, "corrupt-partial");
    writeCogniWeaveMigrationState(root, {
      version: 2,
      phase: "snapshot_copy",
      fromPath: legacy,
      toPath: portable,
      processId: "pid_test",
      fromChecksum: "abc",
      history: [],
    });
    expect(isCogniWeaveCanonicalWriteFrozen(root)).toBe(true);

    const result = ensurePortableCanonicalStoreWithFsm({ dataRoot: root, stateDir });
    expect(result.recovered).toBe(true);
    expect(result.storePath).toBe(legacy);
    expect(fs.existsSync(portable)).toBe(false);
    expect(fs.existsSync(`${portable}.partial`)).toBe(false);
    expect(result.migrationState?.phase).toBe("idle");
    expect(isCogniWeaveCanonicalWriteFrozen(root)).toBe(false);
  });

  it("roll-forwards post-cutover crash to completed", () => {
    const { root, stateDir } = scratch();
    const legacy = resolveLegacyCogniWeaveStorePath(stateDir);
    const portable = resolvePortableCanonicalStorePath(root);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, "legacy");
    fs.mkdirSync(path.dirname(portable), { recursive: true });
    fs.writeFileSync(portable, "legacy");
    writeCogniWeaveMigrationState(root, {
      version: 2,
      phase: "cutover_switched",
      fromPath: legacy,
      toPath: portable,
      processId: "pid_test",
      history: [],
      cutoverAt: new Date().toISOString(),
    });

    const result = ensurePortableCanonicalStoreWithFsm({ dataRoot: root, stateDir });
    expect(result.recovered).toBe(true);
    expect(result.storePath).toBe(portable);
    expect(result.migrationState?.phase).toBe("completed");
  });

  it("switch-back restores legacy authority after completed cutover", () => {
    const { root, stateDir } = scratch();
    const legacy = resolveLegacyCogniWeaveStorePath(stateDir);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, "switch-back-bytes");

    const cutover = ensurePortableCanonicalStoreWithFsm({ dataRoot: root, stateDir });
    expect(cutover.cutoverFromLegacy).toBe(true);

    const switched = switchBackPortableCanonicalStore({ dataRoot: root, stateDir });
    expect(switched.switchedBack).toBe(true);
    expect(switched.storePath).toBe(legacy);
    expect(fs.existsSync(resolvePortableCanonicalStorePath(root))).toBe(false);
    expect(switched.migrationState?.phase).toBe("idle");
  });

  it("assertCogniWeaveWritesAllowed throws while freeze_writes is durable", () => {
    const { root } = scratch();
    writeCogniWeaveMigrationState(root, {
      version: 2,
      phase: "freeze_writes",
      fromPath: "/tmp/from",
      toPath: "/tmp/to",
      processId: "pid_test",
      history: [],
    });
    expect(() => assertCogniWeaveWritesAllowed(root)).toThrow(CogniWeaveWriteFrozenError);
    const state = readCogniWeaveMigrationState(root);
    expect(state?.phase).toBe("freeze_writes");
  });
});
