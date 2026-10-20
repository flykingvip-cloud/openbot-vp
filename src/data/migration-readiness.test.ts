import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  evaluateMigrationReadiness,
  formatMigrationReadinessFinding,
  type MigrationReadinessCheckId,
  type MigrationReadinessFinding,
} from "./migration-readiness.js";

function findingFor(
  findings: MigrationReadinessFinding[],
  checkId: MigrationReadinessCheckId,
): MigrationReadinessFinding {
  const found = findings.find((finding) => finding.checkId === checkId);
  if (!found) {
    throw new Error(`missing finding: ${checkId}`);
  }
  return found;
}

describe("evaluateMigrationReadiness", () => {
  let scratch = "";
  let home = "";
  let stateDir = "";
  let dataRoot = "";
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-mr-"));
    home = path.join(scratch, "home");
    stateDir = path.join(scratch, "state");
    dataRoot = path.join(scratch, "OpenBot");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    env = { HOME: home, OPENBOT_STATE_DIR: stateDir } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  function seedDataSpaceTree(): void {
    fs.mkdirSync(path.join(dataRoot, "agents"), { recursive: true });
    fs.mkdirSync(path.join(dataRoot, ".meta"), { recursive: true });
  }

  it("reports fully ready when data.root is set, tree present, and no legacy layout", () => {
    seedDataSpaceTree();
    const cfg: OpenBotConfig = { data: { root: dataRoot } };
    const report = evaluateMigrationReadiness({ cfg, env });

    expect(report.ready).toBe(true);
    expect(report.exitCode).toBe(0);
    expect(report.dataRoot).toBe(path.resolve(dataRoot));
    expect(report.dataRootConfigured).toBe(true);
    expect(report.findings.every((finding) => finding.severity === "pass")).toBe(true);
  });

  it("warns when data.root is not explicitly configured", () => {
    // Default root ({home}/OpenBot) has no tree, so tree also warns; neither is a hard fail.
    const report = evaluateMigrationReadiness({ cfg: {}, env });
    expect(report.dataRootConfigured).toBe(false);
    expect(findingFor(report.findings, "data-root-configured").severity).toBe("warn");
    expect(report.ready).toBe(true);
    expect(report.exitCode).toBe(0);
  });

  it("warns when the Data Space tree is incomplete", () => {
    fs.mkdirSync(path.join(dataRoot, "agents"), { recursive: true }); // .meta missing
    const report = evaluateMigrationReadiness({ cfg: { data: { root: dataRoot } }, env });
    const tree = findingFor(report.findings, "data-space-tree");
    expect(tree.severity).toBe("warn");
    expect(tree.detail).toContain(".meta");
  });

  it("honors injected dataRoot over cfg.data.root", () => {
    const injected = path.join(dataRoot, "injected-tenant-user");
    fs.mkdirSync(path.join(injected, "agents"), { recursive: true });
    fs.mkdirSync(path.join(injected, ".meta"), { recursive: true });
    const report = evaluateMigrationReadiness({
      cfg: { data: { root: path.join(dataRoot, "ignored") } },
      dataRoot: injected,
      env,
    });
    expect(report.dataRoot).toBe(injected);
  });

  it("flags absolute agents.list[].workspace with a derived remediation target", () => {
    seedDataSpaceTree();
    const cfg: OpenBotConfig = {
      data: { root: dataRoot },
      agents: { list: [{ id: "bot-2", workspace: "/Users/someone/workspace-bot-2" }] },
    };
    const report = evaluateMigrationReadiness({ cfg, env });
    const finding = findingFor(report.findings, "no-absolute-workspace");
    expect(finding.severity).toBe("warn"); // warn without the packaging gate
    expect(finding.remediations).toEqual([
      {
        from: "/Users/someone/workspace-bot-2",
        to: path.join(dataRoot, "agents", "bot-2", "workspace"),
      },
    ]);
    expect(report.ready).toBe(true);
  });

  it("promotes absolute workspace to a hard fail under failOnLegacyWorkspace", () => {
    seedDataSpaceTree();
    const cfg: OpenBotConfig = {
      data: { root: dataRoot },
      agents: { list: [{ id: "bot-2", workspace: "/abs/ws" }] },
    };
    const report = evaluateMigrationReadiness({
      cfg,
      env,
      options: { failOnLegacyWorkspace: true },
    });
    expect(findingFor(report.findings, "no-absolute-workspace").severity).toBe("fail");
    expect(report.ready).toBe(false);
    expect(report.exitCode).toBe(1);
  });

  it("does not flag agent workspaces that are derived (relative/unset)", () => {
    seedDataSpaceTree();
    const cfg: OpenBotConfig = {
      data: { root: dataRoot },
      agents: { list: [{ id: "bot-2" }, { id: "bot-3", workspace: "./relative" }] },
    };
    const report = evaluateMigrationReadiness({ cfg, env });
    expect(findingFor(report.findings, "no-absolute-workspace").severity).toBe("pass");
  });

  it("detects legacy per-agent workspace dirs in the state dir and maps them", () => {
    seedDataSpaceTree();
    const legacy = path.join(stateDir, "workspace-bot-2");
    fs.mkdirSync(legacy, { recursive: true });
    const cfg: OpenBotConfig = { data: { root: dataRoot } };

    const report = evaluateMigrationReadiness({ cfg, env });
    const finding = findingFor(report.findings, "no-legacy-workspace-dirs");
    expect(finding.severity).toBe("warn");
    expect(finding.remediations).toContainEqual({
      from: path.resolve(legacy),
      to: path.join(dataRoot, "agents", "bot-2", "workspace"),
    });
    expect(report.exitCode).toBe(0);

    // Under the packaging gate the same legacy dir fails and yields exit code 1 (SAAS-T-05).
    const gated = evaluateMigrationReadiness({
      cfg,
      env,
      options: { failOnLegacyWorkspace: true },
    });
    expect(findingFor(gated.findings, "no-legacy-workspace-dirs").severity).toBe("fail");
    expect(gated.ready).toBe(false);
    expect(gated.exitCode).toBe(1);
  });

  it("maps the flat legacy default workspace to the default agent space", () => {
    seedDataSpaceTree();
    const legacyDefault = path.join(home, ".openclaw", "workspace");
    fs.mkdirSync(legacyDefault, { recursive: true });
    const cfg: OpenBotConfig = { data: { root: dataRoot } };

    const report = evaluateMigrationReadiness({ cfg, env });
    const finding = findingFor(report.findings, "no-legacy-workspace-dirs");
    expect(finding.remediations).toContainEqual({
      from: path.resolve(legacyDefault),
      to: path.join(dataRoot, "agents", resolveDefaultAgentId(cfg), "workspace"),
    });
  });

  it("flags a legacy knowledge dir as a warning even under the packaging gate", () => {
    seedDataSpaceTree();
    const legacyKnowledge = path.join(stateDir, "knowledge");
    fs.mkdirSync(legacyKnowledge, { recursive: true });
    const cfg: OpenBotConfig = { data: { root: dataRoot } };

    const report = evaluateMigrationReadiness({
      cfg,
      env,
      options: { failOnLegacyWorkspace: true },
    });
    const finding = findingFor(report.findings, "no-legacy-knowledge-dir");
    expect(finding.severity).toBe("warn");
    expect(finding.remediations).toEqual([
      { from: path.resolve(legacyKnowledge), to: path.join(dataRoot, "shared", "knowledge") },
    ]);
    // Knowledge alone must not fail the gate.
    expect(report.ready).toBe(true);
    expect(report.exitCode).toBe(0);
  });

  it("scopes checks with checkPaths / checkAgentsConfig", () => {
    seedDataSpaceTree();
    const cfg: OpenBotConfig = { data: { root: dataRoot } };

    const configOnly = evaluateMigrationReadiness({
      cfg,
      env,
      options: { checkPaths: false },
    });
    const configCheckIds = configOnly.findings.map((finding) => finding.checkId);
    expect(configCheckIds).toEqual(["data-root-configured", "no-absolute-workspace"]);

    const pathsOnly = evaluateMigrationReadiness({
      cfg,
      env,
      options: { checkAgentsConfig: false },
    });
    const pathCheckIds = pathsOnly.findings.map((finding) => finding.checkId);
    expect(pathCheckIds).toEqual([
      "data-space-tree",
      "no-legacy-workspace-dirs",
      "no-legacy-knowledge-dir",
    ]);
  });

  it("formats findings with a glyph and indented remediations", () => {
    const line = formatMigrationReadinessFinding({
      checkId: "no-legacy-workspace-dirs",
      severity: "fail",
      title: "发现 1 处遗留 workspace 目录",
      detail: "须迁入 Data Space。",
      remediations: [{ from: "/state/workspace-bot-2", to: "/OpenBot/agents/bot-2/workspace" }],
    });
    expect(line).toContain("✗");
    expect(line).toContain("/state/workspace-bot-2 → /OpenBot/agents/bot-2/workspace");
  });
});
