import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLandingStreams, buildOwnershipTasks, importFromLegacy } from "../../loom/import.js";
import { validateRegistry } from "../../loom/registry.js";
import type { AuditRule } from "../../worktree-audit.js";

function tmpRepo(): string {
  return mkdtempSync(path.join(os.tmpdir(), "loom-import-"));
}

function writeSpecAgents(cwd: string, spec: string, agentsBlock: string): void {
  const dir = path.join(cwd, ".kiro", "specs", spec);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "tasks.md"), agentsBlock, "utf8");
}

/** A small synthetic legacy rule table mirroring the real exact/prefix shape. */
function syntheticRules(): AuditRule[] {
  const exact =
    (...paths: string[]) =>
    (c: string) =>
      new Set(paths).has(c);
  const prefix =
    (...prefixes: string[]) =>
    (c: string) =>
      prefixes.some((p) => c.startsWith(p));
  const annotate = (
    fn: (c: string) => boolean,
    meta: { __exact?: string[]; __prefix?: string[] },
  ) => Object.assign(fn, meta);
  return [
    {
      id: "merge-guardrails",
      disposition: "MERGE",
      group: "D",
      title: "Guardrails",
      matches: annotate(exact(".gitignore"), { __exact: [".gitignore"] }),
    },
    {
      id: "isolate-ui",
      disposition: "ISOLATE",
      group: "UI",
      title: "UI",
      matches: annotate(prefix("ui/src/"), { __prefix: ["ui/src/"] }),
    },
    {
      id: "clean-generated",
      disposition: "CLEAN",
      group: "G",
      title: "Generated",
      matches: annotate(exact("a2ui.bundle.js"), { __exact: ["a2ui.bundle.js"] }),
    },
  ];
}

describe("loom/import — buildLandingStreams (synthetic)", () => {
  it("maps dispositions to policies and converts exact/prefix to globs", () => {
    const streams = buildLandingStreams(syntheticRules());
    const d = streams.find((s) => s.id === "D");
    const ui = streams.find((s) => s.id === "UI");
    const g = streams.find((s) => s.id === "G");
    expect(d?.landingPolicy).toBe("parallel"); // group D special-cased
    expect(d?.paths).toEqual([".gitignore"]);
    expect(ui?.landingPolicy).toBe("exclusive"); // ISOLATE
    expect(ui?.paths).toEqual(["ui/src/**"]); // prefix → glob
    expect(g?.landingPolicy).toBe("manual"); // CLEAN
  });
});

describe("loom/import — buildLandingStreams (real legacy rules)", () => {
  it("produces a non-empty, schema-valid landing partition", () => {
    const streams = buildLandingStreams();
    expect(streams.length).toBeGreaterThan(0);
    // Guardrails group D maps to parallel.
    expect(streams.find((s) => s.id === "D")?.landingPolicy).toBe("parallel");
    // Overlap is allowed in the audit partition: package.json may appear in >1 stream.
    const streamsWithPkgJson = streams.filter((s) => s.paths.includes("package.json"));
    expect(streamsWithPkgJson.length).toBeGreaterThanOrEqual(1);
  });
});

describe("loom/import — buildOwnershipTasks", () => {
  it("creates one ownership task per (spec, agent) sign-in", () => {
    const cwd = tmpRepo();
    writeSpecAgents(
      cwd,
      "auth-refactor",
      `# Plan

## Agents

- kiro-auth · role: owner · scope: auth · paths: src/auth/login.ts, src/session/store.ts · since: 2026-06-12

## Tasks
`,
    );
    const { tasks, conflicts } = buildOwnershipTasks(cwd);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("auth-refactor:kiro-auth");
    expect(tasks[0].owner).toBe("kiro-auth");
    expect(tasks[0].paths).toEqual(["src/auth/login.ts", "src/session/store.ts"]);
    expect(conflicts).toHaveLength(0);
  });

  it("reproduces the legacy sanitize quirk: `**` is stripped from `## Agents` globs", () => {
    // The legacy agent-attribution parser strips `**` (markdown bold) from the
    // whole row, including path globs. We replicate it so attribution parity vs
    // the legacy source holds; a human fixes degenerate globs post-import.
    const cwd = tmpRepo();
    writeSpecAgents(
      cwd,
      "ui-spec",
      `## Agents

- kiro-ui · role: owner · paths: ui/src/** · since: 2026-06-12
`,
    );
    const { tasks } = buildOwnershipTasks(cwd);
    expect(tasks[0].paths).toEqual(["ui/src/"]);
  });

  it("flags overlapping ownership globs across agents as a conflict", () => {
    const cwd = tmpRepo();
    writeSpecAgents(
      cwd,
      "spec-a",
      `## Agents

- agent-a · role: owner · paths: src/shared/model.ts · since: 2026-06-12
`,
    );
    writeSpecAgents(
      cwd,
      "spec-b",
      `## Agents

- agent-b · role: owner · paths: src/shared/model.ts · since: 2026-06-12
`,
    );
    const { tasks, conflicts } = buildOwnershipTasks(cwd);
    expect(tasks).toHaveLength(2);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].detail).toContain("src/shared/model.ts");
  });

  it("flags NESTED ownership glob overlap (src/** vs src/auth/**), not just identical", () => {
    const cwd = tmpRepo();
    writeSpecAgents(
      cwd,
      "spec-broad",
      `## Agents

- agent-broad · role: owner · paths: src/* · since: 2026-06-12
`,
    );
    writeSpecAgents(
      cwd,
      "spec-narrow",
      `## Agents

- agent-narrow · role: owner · paths: src/auth/ · since: 2026-06-12
`,
    );
    // (legacy sanitize strips `**`; we use single `*` / trailing `/` so the
    // stored globs are `src/` and `src/auth/`, a real prefix-nested overlap.)
    const { conflicts } = buildOwnershipTasks(cwd);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("ownership-overlap");
  });
});

describe("loom/import — importFromLegacy (real repo)", () => {
  it("produces a schema-valid registry from the live legacy sources", () => {
    const { registry } = importFromLegacy(process.cwd());
    // Validates against the zod schema (throws on any violation).
    const validated = validateRegistry(registry);
    expect(validated.version).toBe(1);
    expect(validated.landingStreams.length).toBeGreaterThan(0);
  });
});
