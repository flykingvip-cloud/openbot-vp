/**
 * O2 regression: empty-markdown classes, data-root priority, trusted scope,
 * formal scope source (no invented production fields), and real script entry.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyAgentRecovery,
  classifyEmptyMarkdown,
  resolveAuditDataRoot,
  resolveFormalDefaultScopeHint,
  resolveTrustedScopeAtomCount,
  stableId,
} from "../../scripts/memory-platform-audit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/memory-platform-audit.mjs");

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempState(
  buildCfg: (paths: {
    stateDir: string;
    workspace: string;
    dataRoot: string;
  }) => Record<string, unknown>,
): { stateDir: string; workspace: string; dataRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "o2-audit-entry-"));
  tempDirs.push(root);
  const stateDir = path.join(root, "state");
  const workspace = path.join(root, "workspace-empty");
  const dataRoot = path.join(root, "data");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });
  const cfg = buildCfg({ stateDir, workspace, dataRoot });
  fs.writeFileSync(path.join(stateDir, "openbot.json"), `${JSON.stringify(cfg, null, 2)}\n`);
  return { stateDir, workspace, dataRoot };
}

describe("O2 memory-platform-audit classification", () => {
  it("aligns data root with resolveDataRoot: config beats env", () => {
    const previous = process.env.OPENBOT_DATA_ROOT;
    try {
      process.env.OPENBOT_DATA_ROOT = "/tmp/env-data-root-should-lose";
      const cfgFirst = resolveAuditDataRoot({ data: { root: "/tmp/cfg-data-root-wins" } });
      expect(cfgFirst).toContain("cfg-data-root-wins");
      expect(cfgFirst).not.toContain("env-data-root-should-lose");

      delete process.env.OPENBOT_DATA_ROOT;
      process.env.OPENBOT_DATA_ROOT = "/tmp/env-data-root-fallback";
      const envFallback = resolveAuditDataRoot({});
      expect(envFallback).toContain("env-data-root-fallback");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_DATA_ROOT;
      } else {
        process.env.OPENBOT_DATA_ROOT = previous;
      }
      delete process.env.OPENCLAW_DATA_ROOT;
    }
  });

  it("does not infer new-empty-agent from zero atoms without createdAt+expectedEmpty", () => {
    const withoutEvidence = classifyEmptyMarkdown({
      backend: "cogniweave",
      memoryMdAtResolved: 0,
      scopeAtomCount: 0,
      scopeReadable: true,
      scopeTrusted: true,
      configuredWorkspace: "/ws/main",
      cogniweaveMode: "embedded",
    });
    expect(withoutEvidence?.emptyMarkdownClass).toBe("diagnostic-insufficient");
    expect(withoutEvidence?.action).toBe("diagnostic-insufficient");

    const withEvidence = classifyEmptyMarkdown({
      backend: "cogniweave",
      memoryMdAtResolved: 0,
      scopeAtomCount: 0,
      scopeReadable: true,
      scopeTrusted: true,
      configuredWorkspace: "/ws/main",
      cogniweaveMode: "embedded",
      agentCreatedAt: "2026-10-26T00:00:00.000Z",
      expectedEmptyEvidence: true,
    });
    expect(withEvidence?.emptyMarkdownClass).toBe("new-empty-agent");
    expect(withEvidence?.priority).toBe("info");
  });

  it("marks incomplete scope as diagnostic-insufficient", () => {
    const result = classifyEmptyMarkdown({
      backend: "cogniweave",
      memoryMdAtResolved: 0,
      scopeAtomCount: null,
      scopeReadable: true,
      scopeTrusted: false,
      configuredWorkspace: "/ws/main",
      cogniweaveMode: "embedded",
    });
    expect(result?.emptyMarkdownClass).toBe("diagnostic-insufficient");
  });

  it("does not declare cogniweave-scope-ok from non-empty markdown alone", () => {
    const insufficient = classifyAgentRecovery({
      memoryMdAtResolved: 3,
      alternateRoots: [],
      conflictByRule: false,
      secretConfigured: true,
      resolvedWorkspace: "/ws/main",
      backend: "cogniweave",
      scopeAtomCount: null,
      scopeReadable: true,
      scopeTrusted: false,
      configuredWorkspace: "/ws/main",
      cogniweaveMode: "embedded",
    });
    expect(insufficient.action).toBe("diagnostic-insufficient");

    const ok = classifyAgentRecovery({
      memoryMdAtResolved: 3,
      alternateRoots: [],
      conflictByRule: false,
      secretConfigured: true,
      resolvedWorkspace: "/ws/main",
      backend: "cogniweave",
      scopeAtomCount: 2,
      scopeReadable: true,
      scopeTrusted: true,
      configuredWorkspace: "/ws/main",
      cogniweaveMode: "embedded",
    });
    expect(ok.action).toBe("cogniweave-scope-ok");
  });

  it("keeps REST empty markdown as diagnostic-insufficient", () => {
    const result = classifyEmptyMarkdown({
      backend: "cogniweave",
      memoryMdAtResolved: 0,
      scopeAtomCount: 0,
      scopeReadable: false,
      scopeTrusted: false,
      configuredWorkspace: "/ws/main",
      cogniweaveMode: "rest",
      agentCreatedAt: "2026-10-26T00:00:00.000Z",
      expectedEmptyEvidence: true,
    });
    expect(result?.emptyMarkdownClass).toBe("diagnostic-insufficient");
    expect(result?.action).toBe("cogniweave-rest-unknown");
  });
});

describe("O2 formal scope source (no invented production fields)", () => {
  it("derives formal default scope from legacy workspaceId + resolveCogniWeaveSearchScope shape", () => {
    const stateDir = "/tmp/o2-formal-scope-state";
    const resolved = resolveFormalDefaultScopeHint({ agentId: "main", stateDir });
    expect(resolved.scopeSource).toBe("formal-default-legacy-ws+resolveCogniWeaveSearchScope");
    expect(resolved.scopeHint).toEqual({
      workspaceId: stableId("ws", path.resolve(stateDir)),
      projectId: "agent:main",
      visibility: "private",
    });
  });

  it("returns unknown when agentId or stateDir missing (insufficient identity is legal)", () => {
    expect(resolveFormalDefaultScopeHint({ agentId: "", stateDir: "/x" }).scopeSource).toBe(
      "unknown",
    );
    expect(resolveFormalDefaultScopeHint({ agentId: "main", stateDir: "" }).scopeHint).toBeNull();
  });

  it("does not trust incomplete scope hints", () => {
    const incomplete = resolveTrustedScopeAtomCount({
      counts: {
        readable: true,
        scopeTrusted: true,
        byCompleteScope: { "ws::agent:main::main::private": 3 },
      },
      agentId: "main",
      scopeHint: { workspaceId: "ws", projectId: "agent:main" }, // missing visibility
    });
    expect(incomplete.scopeTrusted).toBe(false);
    expect(incomplete.scopeAtomCount).toBeNull();
  });
});

describe("O2 real script entry (spawn memory-platform-audit.mjs)", () => {
  it("runs CLI entry and reports diagnostic-insufficient without invented expectedEmpty fields", () => {
    const { stateDir } = makeTempState(({ workspace, dataRoot }) => ({
      data: { root: dataRoot, mode: "local", schemaVersion: 1 },
      memory: { backend: "cogniweave", cogniweave: { mode: "embedded" } },
      agents: {
        list: [
          {
            id: "empty-agent",
            workspace,
            // Intentionally include invented fields — script must IGNORE them.
            memoryScope: {
              workspaceId: "forged-ws",
              projectId: "forged-project",
              visibility: "private",
            },
            expectedEmpty: true,
            expectedNoData: true,
            createdAt: "2026-10-26T00:00:00.000Z",
          },
        ],
      },
    }));

    const result = spawnSync(process.execPath, [SCRIPT, "--json"], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENBOT_STATE_DIR: stateDir,
        OPENBOT_TENANTS_ROOT: "",
      },
    });
    expect(result.status, `stderr=${result.stderr}`).toBe(0);
    const report = JSON.parse(result.stdout || "{}") as {
      agents: Array<{
        agentId: string;
        scopeSource?: string;
        scopeHint?: { workspaceId: string; projectId: string; visibility: string } | null;
        expectedEmptyEvidence?: boolean;
        agentCreatedAt?: string | null;
        emptyMarkdownClass?: string | null;
        recovery?: { action?: string };
        scopeTrusted?: boolean;
      }>;
    };
    const row = report.agents.find((a) => a.agentId === "empty-agent");
    expect(row).toBeTruthy();
    expect(row?.scopeSource).toBe("formal-default-legacy-ws+resolveCogniWeaveSearchScope");
    expect(row?.scopeHint?.workspaceId).toBe(stableId("ws", path.resolve(stateDir)));
    expect(row?.scopeHint?.projectId).toBe("agent:empty-agent");
    expect(row?.scopeHint?.visibility).toBe("private");
    // Invented production fields must not drive evidence / new-empty.
    expect(row?.expectedEmptyEvidence).toBe(false);
    expect(row?.agentCreatedAt).toBeNull();
    expect(row?.scopeHint?.workspaceId).not.toBe("forged-ws");
    expect(
      row?.emptyMarkdownClass === "diagnostic-insufficient" ||
        row?.recovery?.action === "diagnostic-insufficient",
    ).toBe(true);
    expect(row?.emptyMarkdownClass).not.toBe("new-empty-agent");
  });

  it("reports formal scopeSource even when store is missing (unknown/insufficient, not forged ok)", () => {
    const { stateDir, workspace } = makeTempState(({ workspace, dataRoot }) => ({
      data: { root: dataRoot, mode: "local", schemaVersion: 1 },
      memory: { backend: "cogniweave", cogniweave: { mode: "embedded" } },
      agents: { list: [{ id: "main", workspace }] },
    }));
    fs.writeFileSync(path.join(workspace, "MEMORY.md"), "hello\n");

    const result = spawnSync(process.execPath, [SCRIPT, "--json"], {
      encoding: "utf8",
      env: { ...process.env, OPENBOT_STATE_DIR: stateDir },
    });
    expect(result.status, `stderr=${result.stderr}`).toBe(0);
    const report = JSON.parse(result.stdout || "{}") as {
      agents: Array<{
        agentId: string;
        scopeSource?: string;
        scopeTrusted?: boolean;
        scopeReadable?: boolean;
        recovery?: { action?: string };
      }>;
    };
    const row = report.agents.find((a) => a.agentId === "main");
    expect(row?.scopeSource).toBe("formal-default-legacy-ws+resolveCogniWeaveSearchScope");
    // Missing store → not readable → must not claim scope-ok.
    expect(row?.recovery?.action).not.toBe("cogniweave-scope-ok");
    expect(
      row?.recovery?.action === "diagnostic-insufficient" || row?.scopeReadable === false,
    ).toBe(true);
  });
});
