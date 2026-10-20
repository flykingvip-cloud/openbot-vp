import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LATEST_VERSION,
  RegistryError,
  RegistryNotFoundError,
  emptyRegistry,
  loadRegistry,
  registryPath,
  saveRegistry,
  upgradeRegistry,
  validateRegistry,
} from "../../loom/registry.js";

function tmpRepo(): string {
  return mkdtempSync(path.join(os.tmpdir(), "loom-registry-"));
}

function writeRegistry(cwd: string, contents: string): void {
  const file = registryPath(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, "utf8");
}

const VALID_YAML = `version: 1
tasks:
  - id: loom-core
    owner: kiro-loom
    intent: [backend]
    paths:
      - scripts/loom/**
    state: active
    sessions:
      - id: s1
        taskId: loom-core
        ide: kiro
        agent: kiro-loom
        status: active
landingStreams:
  - id: loom-core
    paths:
      - scripts/loom/**
    landingPolicy: serial
`;

describe("loom/registry — load + validate", () => {
  it("loads a valid v1 registry with defaults applied", () => {
    const cwd = tmpRepo();
    writeRegistry(cwd, VALID_YAML);
    const registry = loadRegistry(cwd);
    expect(registry.version).toBe(LATEST_VERSION);
    expect(registry.tasks).toHaveLength(1);
    const task = registry.tasks[0];
    expect(task.id).toBe("loom-core");
    expect(task.owner).toBe("kiro-loom");
    expect(task.metadata).toEqual({});
    expect(task.sessions[0].metadata).toEqual({});
    expect(task.sessions[0].status).toBe("active");
    expect(registry.landingStreams[0].landingPolicy).toBe("serial");
  });

  it("throws RegistryNotFoundError with guidance when file is missing", () => {
    const cwd = tmpRepo();
    expect(() => loadRegistry(cwd)).toThrow(RegistryNotFoundError);
    expect(() => loadRegistry(cwd)).toThrow(/loom import/);
  });

  it("reports a locatable error with the task id for a bad field", () => {
    const cwd = tmpRepo();
    writeRegistry(
      cwd,
      `version: 1
tasks:
  - id: broken-task
    owner: kiro-loom
    state: nonsense
`,
    );
    expect(() => loadRegistry(cwd)).toThrow(RegistryError);
    expect(() => loadRegistry(cwd)).toThrow(/broken-task/);
  });

  it("rejects a missing top-level version", () => {
    const cwd = tmpRepo();
    writeRegistry(cwd, `tasks: []\n`);
    expect(() => loadRegistry(cwd)).toThrow(/version/);
  });

  it("rejects a session whose taskId does not match its task (review P1)", () => {
    const cwd = tmpRepo();
    writeRegistry(
      cwd,
      `version: 1
tasks:
  - id: task-a
    owner: kiro-loom
    sessions:
      - id: s1
        taskId: task-b
        ide: cursor
        agent: a
`,
    );
    expect(() => loadRegistry(cwd)).toThrow(/mismatched taskId/);
  });
});

describe("loom/registry — schema evolution", () => {
  it("rejects a version newer than supported (no silent downgrade)", () => {
    expect(() => upgradeRegistry({ version: LATEST_VERSION + 1, tasks: [] })).toThrow(
      /newer than supported/,
    );
  });

  it("passes through a current-version registry unchanged", () => {
    const input = { version: LATEST_VERSION, tasks: [] };
    expect(upgradeRegistry(input)).toEqual(input);
  });

  it("errors when no upgrader exists for an older version", () => {
    // version 0 has no registered upgrader to 1.
    expect(() => upgradeRegistry({ version: 0, tasks: [] })).toThrow(/No upgrader/);
  });
});

describe("loom/registry — save round-trip", () => {
  it("writes then reads back an equivalent registry", () => {
    const cwd = tmpRepo();
    const registry = validateRegistry({
      version: LATEST_VERSION,
      tasks: [
        {
          id: "auth-refactor",
          owner: "kiro-loom",
          intent: ["backend", "migration"],
          paths: ["src/auth/**"],
          state: "active",
          sessions: [],
          metadata: { jira: "AUTH-123" },
        },
      ],
      landingStreams: [
        {
          id: "auth-stream",
          paths: ["src/auth/**"],
          landingPolicy: "exclusive",
          canLandWith: ["auth-docs"],
        },
      ],
    });
    saveRegistry(registry, cwd);
    const reloaded = loadRegistry(cwd);
    expect(reloaded).toEqual(registry);
    expect(reloaded.tasks[0].metadata).toEqual({ jira: "AUTH-123" });
    expect(reloaded.landingStreams[0].landingPolicy).toBe("exclusive");
  });

  it("emptyRegistry is valid and round-trips", () => {
    const cwd = tmpRepo();
    saveRegistry(emptyRegistry(), cwd);
    expect(loadRegistry(cwd)).toEqual(emptyRegistry());
  });
});

// The `issue` field is the join key that makes intent → code → release traceable
// (engineering-governance R2.2). It is a REAL column, not a `metadata` entry, and
// it must stay optional so the 126 pre-existing registry entries keep loading.
describe("loom/registry — issue binding (R2.2)", () => {
  it("loads and round-trips a task with an issue number", () => {
    const cwd = tmpRepo();
    writeRegistry(
      cwd,
      `version: 1
tasks:
  - id: 234-enterprise-plan
    owner: cursor-agent
    issue: 234
    paths:
      - src/billing/**
    state: active
`,
    );
    const registry = loadRegistry(cwd);
    expect(registry.tasks[0].issue).toBe(234);
    saveRegistry(registry, cwd);
    expect(loadRegistry(cwd).tasks[0].issue).toBe(234);
  });

  it("keeps issue optional so existing registries still load", () => {
    const cwd = tmpRepo();
    writeRegistry(cwd, VALID_YAML);
    expect(loadRegistry(cwd).tasks[0].issue).toBeUndefined();
  });

  it("rejects a non-positive or non-integer issue with a locatable error", () => {
    for (const bad of ["0", "-5", "1.5"]) {
      const cwd = tmpRepo();
      writeRegistry(
        cwd,
        `version: 1
tasks:
  - id: bad-issue-task
    owner: kiro-loom
    issue: ${bad}
`,
      );
      expect(() => loadRegistry(cwd)).toThrow(RegistryError);
      expect(() => loadRegistry(cwd)).toThrow(/bad-issue-task/);
    }
  });

  it("rejects a non-numeric issue (no silent string coercion)", () => {
    const cwd = tmpRepo();
    writeRegistry(
      cwd,
      `version: 1
tasks:
  - id: string-issue-task
    owner: kiro-loom
    issue: "234"
`,
    );
    expect(() => loadRegistry(cwd)).toThrow(/string-issue-task/);
  });

  it("does not accept issue smuggled through metadata (must be a real column)", () => {
    // metadata is `.passthrough()`, so `metadata.issue` would be silently retained
    // but is NOT the join key. Guard that the real column stays undefined, so a
    // task that only sets metadata.issue is still reported by lint as unbound.
    const cwd = tmpRepo();
    writeRegistry(
      cwd,
      `version: 1
tasks:
  - id: metadata-only-task
    owner: kiro-loom
    metadata:
      issue: 234
`,
    );
    const task = loadRegistry(cwd).tasks[0];
    expect(task.issue).toBeUndefined();
  });
});

// P2.1 — `sharedPaths`: paths several ownership tasks legitimately touch, each
// with ONE designated lander. Empty default is the parity baseline.
describe("loom/registry — sharedPaths (P2.1)", () => {
  it("defaults to an empty array, so existing registries are unaffected", () => {
    const cwd = tmpRepo();
    writeRegistry(cwd, VALID_YAML);
    expect(loadRegistry(cwd).sharedPaths).toEqual([]);
  });

  it("emptyRegistry carries the empty default and round-trips", () => {
    const cwd = tmpRepo();
    saveRegistry(emptyRegistry(), cwd);
    expect(loadRegistry(cwd).sharedPaths).toEqual([]);
  });

  it("loads and round-trips glob / landerTask / reason", () => {
    const cwd = tmpRepo();
    writeRegistry(
      cwd,
      `version: 1
tasks:
  - id: loom-task
    owner: kiro-loom
    paths: [docs/**]
    sessions: []
  - id: i18n-task
    owner: kiro-i18n
    paths: [docs/**]
    sessions: []
sharedPaths:
  - glob: AGENTS.md
    landerTask: loom-task
    reason: repo-wide agent rulebook
  - glob: ui/src/i18n/**
    landerTask: i18n-task
`,
    );
    const registry = loadRegistry(cwd);
    expect(registry.sharedPaths).toEqual([
      { glob: "AGENTS.md", landerTask: "loom-task", reason: "repo-wide agent rulebook" },
      { glob: "ui/src/i18n/**", landerTask: "i18n-task" },
    ]);
    saveRegistry(registry, cwd);
    expect(loadRegistry(cwd).sharedPaths).toEqual(registry.sharedPaths);
  });

  it("preserves declaration order (first declared match wins downstream)", () => {
    const cwd = tmpRepo();
    writeRegistry(
      cwd,
      `version: 1
tasks:
  - id: first-task
    owner: first
    paths: [docs/**]
    sessions: []
  - id: second-task
    owner: second
    paths: [docs/**]
    sessions: []
sharedPaths:
  - glob: AGENTS.md
    landerTask: first-task
  - glob: "*.md"
    landerTask: second-task
`,
    );
    expect(loadRegistry(cwd).sharedPaths.map((s) => s.landerTask)).toEqual([
      "first-task",
      "second-task",
    ]);
  });

  // An empty landerTask would leave the path shared with nobody accountable for
  // landing it — exactly the state the field exists to eliminate.
  it("rejects an empty landerTask, naming the offending glob", () => {
    const cwd = tmpRepo();
    writeRegistry(
      cwd,
      `version: 1
tasks: []
sharedPaths:
  - glob: AGENTS.md
    landerTask: ""
`,
    );
    expect(() => loadRegistry(cwd)).toThrow(RegistryError);
    expect(() => loadRegistry(cwd)).toThrow(/sharedPath "AGENTS.md"/);
  });

  it("rejects a missing landerTask", () => {
    const cwd = tmpRepo();
    writeRegistry(cwd, `version: 1\ntasks: []\nsharedPaths:\n  - glob: AGENTS.md\n`);
    expect(() => loadRegistry(cwd)).toThrow(/sharedPath "AGENTS.md"/);
  });

  it("rejects an empty glob, falling back to the index in the error", () => {
    const cwd = tmpRepo();
    writeRegistry(
      cwd,
      `version: 1\ntasks: []\nsharedPaths:\n  - glob: ""\n    landerTask: loom-task\n`,
    );
    expect(() => loadRegistry(cwd)).toThrow(/sharedPaths\[0\]/);
  });
});
