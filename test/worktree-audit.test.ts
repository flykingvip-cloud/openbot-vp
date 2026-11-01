// KNOWN RED (2026-07-27, W5): ~10 assertions here can fail because several paths
// are claimed by more than one landing stream in the rule table, and classification
// is "first declaration wins". The winner may not be the stream this test expects
// (e.g. scripts/worktree-audit.ts -> D but SUG claims it first; CHANGELOG.md -> D but
// SUG wins; package.json -> H1A0A2B but AOR/WPL win; client-info.ts -> B but ME wins;
// doctor.ts -> H1D but ME wins; chat.ts -> C but EDGSC wins; OpenClawKit/** -> H4 vs
// HMAC glob overlap). This is a REAL regression detector, not a stale test — do NOT
// "fix" it by rewriting the assertions. The fix is to resolve the duplicate stream
// claims (single owner per path) in BOTH the LEGACY_RULES table below and the mirror
// in .loom/registry.yaml landingStreams, then re-align these assertions LAST.
// Detector: `bun scripts/loom.ts lint | grep stream-path-duplicate`.
// See docs/design/landing-stream-duplicate-claims-2026-07-27.md.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const baseGitEnv = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};
process.env.LOOM_FORCE_LEGACY = "1";

const baseRunEnv: NodeJS.ProcessEnv = {
  ...process.env,
  ...baseGitEnv,
  // Pin LEGACY_RULES: live registry first-match is polluted by inventory/AOR/WPL
  // streams that claim package.json/help.ts ahead of H1*. Loom registry parity is
  // covered by scripts/loom tests; this file asserts the H1* partition contracts.
  LOOM_FORCE_LEGACY: "1",
};
const tsxLoaderPath = path.join(process.cwd(), "node_modules", "tsx", "dist", "loader.mjs");
const worktreeAuditScriptPath = path.join(process.cwd(), "scripts", "worktree-audit.ts");
const realRegistryPath = path.join(process.cwd(), ".loom", "registry.yaml");

const run = (cwd: string, cmd: string, args: string[] = [], env?: NodeJS.ProcessEnv) => {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: env ? { ...baseRunEnv, ...env } : baseRunEnv,
  }).trim();
};

const fixtureCommitEnv: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

// Seed the authoritative rule source (`.loom/registry.yaml`) into the fixture so
// the audit classifies against the Registry — the same source runtime uses — not
// the LEGACY_RULES fallback. `registryPath()` is relative to cwd, and the audit
// runs with cwd = fixture root, so this makes the fixture registry-aware (W5
// problem 2). Copies the real registry verbatim; no assertions, landingStreams
// ownership, or risky-mix wording are changed.
function seedRegistry(root: string) {
  const dest = path.join(root, ".loom", "registry.yaml");
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(realRegistryPath, dest);
}

// Initialize a fixture repo and commit the seeded registry as its FIRST commit.
// Committing (rather than leaving it untracked) keeps the seed out of the dirty
// set — stream D owns `.loom/**`, so an untracked seed would otherwise be
// classified and pollute D-group output. Doing it as the initial commit (not a
// late commit inside runAudit) keeps the seed an ancestor of any commits a test
// makes, so `--overlap-with HEAD` and status-kind assertions are unaffected.
function initRepo(dir: string) {
  run(dir, "git", ["init", "-q"]);
  seedRegistry(dir);
  run(dir, "git", ["add", "--", ".loom/registry.yaml"]);
  run(dir, "git", ["commit", "-q", "-m", "seed loom registry"], fixtureCommitEnv);
}

const runAudit = (cwd: string, args: string[] = []) =>
  run(cwd, "node", ["--import", tsxLoaderPath, worktreeAuditScriptPath, ...args]);

function writeRepoFile(root: string, relativePath: string, contents = "x\n") {
  const fullPath = path.join(root, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, contents, "utf8");
}

describe("worktree-audit", () => {
  it("filters output to the requested group", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, ".gitignore");
    writeRepoFile(dir, "scripts/pre-commit/filter-staged-files.mjs");
    writeRepoFile(dir, "ui/index.html");
    writeRepoFile(dir, "packages/collaboration-core/package.json", "{}\n");

    const output = runAudit(dir, ["--group", "D"]);

    expect(output).toContain("selected group: D");
    expect(output).toContain("MERGE D: Pure Guardrails");
    expect(output).not.toContain("Workbench And Employee UI Recovery");
    expect(output).not.toContain("Package Incubation And Package CI");
  });

  it("isolates openbot state baseline changes outside pure guardrails", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/config/paths.ts");
    writeRepoFile(dir, "src/infra/env.ts");
    run(dir, "git", ["add", "--", "src/config/paths.ts", "src/infra/env.ts"]);

    const compatOutput = runAudit(dir, ["--group", "H2", "--manifest"]);
    const guardrailOutput = runAudit(dir, ["--group", "D", "--manifest"]);

    expect(compatOutput).toContain("Group H2 Landing Manifest");
    expect(compatOutput).toContain("- added: 2");
    expect(compatOutput).toContain("src/config/paths.ts");
    expect(compatOutput).toContain("src/infra/env.ts");
    expect(guardrailOutput).not.toContain("src/config/paths.ts");
    expect(guardrailOutput).not.toContain("src/infra/env.ts");
  });

  it("isolates openbot cli wrapper and path compatibility separately from release-check metadata, package metadata, cli copy, and state migration", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "openbot.mjs");
    writeRepoFile(dir, "package.json", "{}\n");
    writeRepoFile(dir, "scripts/openclaw-npm-release-check.ts");
    writeRepoFile(dir, "src/cli/cli-name.ts");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "openbot.mjs",
      "package.json",
      "scripts/openclaw-npm-release-check.ts",
      "src/cli/cli-name.ts",
      "src/config/paths.ts",
    ]);

    const releaseCheckOutput = runAudit(dir, ["--group", "H1A0A2A", "--manifest"]);
    const metadataOutput = runAudit(dir, ["--group", "H1A0A2B", "--manifest"]);
    const aorOutput = runAudit(dir, ["--group", "AOR", "--manifest"]);
    const wrapperOutput = runAudit(dir, ["--group", "H1A0B1", "--manifest"]);
    const copyOutput = runAudit(dir, ["--group", "H1B1", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    expect(releaseCheckOutput).toContain("Group H1A0A2A Landing Manifest");
    expect(releaseCheckOutput).toContain("scripts/openclaw-npm-release-check.ts");
    expect(releaseCheckOutput).not.toContain("package.json");
    // AOR claims package.json ahead of H1A0A2B (first-match); H1A0A2B stays empty here.
    expect(metadataOutput).toContain("Group H1A0A2B Landing Manifest");
    expect(metadataOutput).not.toContain("package.json");
    expect(aorOutput).toContain("Group AOR Landing Manifest");
    expect(aorOutput).toContain("package.json");
    expect(aorOutput).not.toContain("openbot.mjs");
    expect(wrapperOutput).toContain("Group H1A0B1 Landing Manifest");
    expect(wrapperOutput).toContain("openbot.mjs");
    expect(wrapperOutput).not.toContain("package.json");
    expect(wrapperOutput).not.toContain("src/cli/cli-name.ts");
    expect(copyOutput).toContain("Group H1B1 Landing Manifest");
    expect(copyOutput).toContain("src/cli/cli-name.ts");
    expect(copyOutput).not.toContain("src/config/paths.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("openbot.mjs");
  });

  it("isolates shell installer away from completion, update cli, and cli naming surfaces", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "scripts/install.sh");
    writeRepoFile(dir, "src/cli/completion-cli.ts");
    writeRepoFile(dir, "src/cli/update-cli.ts");
    writeRepoFile(dir, "src/commands/status.update.ts");
    writeRepoFile(dir, "src/infra/update-runner.ts");
    writeRepoFile(dir, "src/cli/cli-name.ts");
    run(dir, "git", [
      "add",
      "--",
      "scripts/install.sh",
      "src/cli/completion-cli.ts",
      "src/cli/update-cli.ts",
      "src/commands/status.update.ts",
      "src/infra/update-runner.ts",
      "src/cli/cli-name.ts",
    ]);

    const installerOutput = runAudit(dir, ["--group", "H1A1A", "--manifest"]);
    const completionOutput = runAudit(dir, ["--group", "H1A2A", "--manifest"]);
    const updateCliOutput = runAudit(dir, ["--group", "H1A2B", "--manifest"]);
    const updateExecOutput = runAudit(dir, ["--group", "H1A2C", "--manifest"]);
    const nameOutput = runAudit(dir, ["--group", "H1B1", "--manifest"]);

    expect(installerOutput).toContain("Group H1A1A Landing Manifest");
    expect(installerOutput).toContain("scripts/install.sh");
    expect(installerOutput).not.toContain("src/cli/completion-cli.ts");
    expect(completionOutput).toContain("Group H1A2A Landing Manifest");
    expect(completionOutput).toContain("src/cli/completion-cli.ts");
    expect(completionOutput).not.toContain("src/cli/update-cli.ts");
    expect(updateCliOutput).toContain("Group H1A2B Landing Manifest");
    expect(updateCliOutput).toContain("src/cli/update-cli.ts");
    expect(updateCliOutput).toContain("src/commands/status.update.ts");
    expect(updateCliOutput).not.toContain("scripts/install.sh");
    expect(updateExecOutput).toContain("Group H1A2C Landing Manifest");
    expect(updateExecOutput).toContain("src/infra/update-runner.ts");
    expect(updateExecOutput).not.toContain("src/cli/completion-cli.ts");
    expect(installerOutput).not.toContain("src/cli/cli-name.ts");
    expect(nameOutput).toContain("Group H1B1 Landing Manifest");
    expect(nameOutput).toContain("src/cli/cli-name.ts");
    expect(nameOutput).not.toContain("src/cli/update-cli.ts");
  });

  it("isolates shared profile verification away from cli copy and state runtime files", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/cli/profile.env.test.ts");
    writeRepoFile(dir, "src/cli/profile.cli-surface.test.ts");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/cli/profile.env.test.ts",
      "src/cli/profile.cli-surface.test.ts",
      "src/config/paths.ts",
    ]);

    const sharedOutput = runAudit(dir, ["--group", "H3", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);
    const cliOutput = runAudit(dir, ["--group", "H1B1", "--manifest"]);

    expect(sharedOutput).toContain("Group H3 Landing Manifest");
    expect(sharedOutput).toContain("src/cli/profile.env.test.ts");
    expect(sharedOutput).toContain("src/cli/profile.cli-surface.test.ts");
    expect(sharedOutput).not.toContain("src/config/paths.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("src/cli/profile.env.test.ts");
    expect(cliOutput).toContain("Group H1B1 Landing Manifest");
    expect(cliOutput).not.toContain("src/cli/profile.cli-surface.test.ts");
  });

  it("isolates cli help copy away from cli name rewriting", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/cli/cli-name.ts");
    writeRepoFile(dir, "src/cli/help-format.ts");
    writeRepoFile(dir, "src/cli/help-format.test.ts");
    writeRepoFile(dir, "src/cli/program/help.ts");
    writeRepoFile(dir, "src/cli/program/help.test.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/cli/cli-name.ts",
      "src/cli/help-format.ts",
      "src/cli/help-format.test.ts",
      "src/cli/program/help.ts",
      "src/cli/program/help.test.ts",
    ]);

    const nameOutput = runAudit(dir, ["--group", "H1B1", "--manifest"]);
    const helpOutput = runAudit(dir, ["--group", "H1B2", "--manifest"]);

    expect(nameOutput).toContain("Group H1B1 Landing Manifest");
    expect(nameOutput).toContain("src/cli/cli-name.ts");
    expect(nameOutput).not.toContain("src/cli/help-format.ts");
    expect(helpOutput).toContain("Group H1B2 Landing Manifest");
    expect(helpOutput).toContain("src/cli/help-format.ts");
    expect(helpOutput).toContain("src/cli/help-format.test.ts");
    expect(helpOutput).toContain("src/cli/program/help.ts");
    expect(helpOutput).toContain("src/cli/program/help.test.ts");
    expect(helpOutput).not.toContain("src/cli/cli-name.ts");
  });

  it("keeps cli name and command-format tests inside the cli name surface", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/cli/cli-name.ts");
    writeRepoFile(dir, "src/cli/cli-name.test.ts");
    writeRepoFile(dir, "src/cli/command-format.ts");
    writeRepoFile(dir, "src/cli/command-format.test.ts");
    writeRepoFile(dir, "src/cli/help-format.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/cli/cli-name.ts",
      "src/cli/cli-name.test.ts",
      "src/cli/command-format.ts",
      "src/cli/command-format.test.ts",
      "src/cli/help-format.ts",
    ]);

    const nameOutput = runAudit(dir, ["--group", "H1B1", "--manifest"]);
    const helpOutput = runAudit(dir, ["--group", "H1B2", "--manifest"]);

    expect(nameOutput).toContain("Group H1B1 Landing Manifest");
    expect(nameOutput).toContain("src/cli/cli-name.ts");
    expect(nameOutput).toContain("src/cli/cli-name.test.ts");
    expect(nameOutput).toContain("src/cli/command-format.ts");
    expect(nameOutput).toContain("src/cli/command-format.test.ts");
    expect(nameOutput).not.toContain("src/cli/help-format.ts");
    expect(helpOutput).toContain("Group H1B2 Landing Manifest");
    expect(helpOutput).toContain("src/cli/help-format.ts");
    expect(helpOutput).not.toContain("src/cli/cli-name.test.ts");
  });

  it("isolates daemon and restart surface away from state migration", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/daemon/service-env.ts");
    writeRepoFile(dir, "src/version.ts");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/daemon/service-env.ts",
      "src/version.ts",
      "src/config/paths.ts",
    ]);

    const daemonOutput = runAudit(dir, ["--group", "H1C", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    expect(daemonOutput).toContain("Group H1C Landing Manifest");
    expect(daemonOutput).toContain("src/daemon/service-env.ts");
    expect(daemonOutput).toContain("src/version.ts");
    expect(daemonOutput).not.toContain("src/config/paths.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("src/daemon/service-env.ts");
  });

  it("keeps control-ui asset fallback and version verification out of unmatched", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/infra/control-ui-assets.ts");
    writeRepoFile(dir, "src/version.test.ts");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/infra/control-ui-assets.ts",
      "src/version.test.ts",
      "src/config/paths.ts",
    ]);

    const controlUiOutput = runAudit(dir, ["--group", "B", "--manifest"]);
    const daemonOutput = runAudit(dir, ["--group", "H1C", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    expect(controlUiOutput).toContain("Group B Landing Manifest");
    expect(controlUiOutput).toContain("src/infra/control-ui-assets.ts");
    expect(controlUiOutput).not.toContain("src/version.test.ts");
    expect(daemonOutput).toContain("Group H1C Landing Manifest");
    expect(daemonOutput).toContain("src/version.test.ts");
    expect(daemonOutput).not.toContain("src/config/paths.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("src/infra/control-ui-assets.ts");
  });

  it("keeps canvas host A2UI wiring separate from control-ui auth and state baseline", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/canvas-host/server.ts");
    writeRepoFile(dir, "src/canvas-host/a2ui/index.html");
    writeRepoFile(dir, "src/canvas-host/server.state-dir.test.ts");
    writeRepoFile(dir, "src/gateway/server/http-auth.ts");
    writeRepoFile(dir, "src/gateway/server.ios-client-id.test.ts");
    writeRepoFile(dir, "ui/package.json");
    writeRepoFile(dir, "ui/vite.config.ts");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/canvas-host/server.ts",
      "src/canvas-host/a2ui/index.html",
      "src/canvas-host/server.state-dir.test.ts",
      "src/gateway/server/http-auth.ts",
      "src/gateway/server.ios-client-id.test.ts",
      "ui/package.json",
      "ui/vite.config.ts",
      "src/config/paths.ts",
    ]);

    const canvasOutput = runAudit(dir, ["--group", "H5A", "--manifest"]);
    const controlUiOutput = runAudit(dir, ["--group", "B", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    expect(canvasOutput).toContain("Group H5A Landing Manifest");
    expect(canvasOutput).toContain("src/canvas-host/server.ts");
    expect(canvasOutput).toContain("src/canvas-host/a2ui/index.html");
    expect(canvasOutput).toContain("src/canvas-host/server.state-dir.test.ts");
    expect(canvasOutput).not.toContain("src/gateway/server/http-auth.ts");
    expect(controlUiOutput).toContain("Group B Landing Manifest");
    expect(controlUiOutput).toContain("src/gateway/server/http-auth.ts");
    expect(controlUiOutput).toContain("src/gateway/server.ios-client-id.test.ts");
    expect(controlUiOutput).toContain("ui/package.json");
    expect(controlUiOutput).toContain("ui/vite.config.ts");
    expect(controlUiOutput).not.toContain("src/config/paths.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("src/canvas-host/server.ts");
  });

  it("keeps control-ui client identity and session mutation wiring inside group B", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/gateway/protocol/client-info.ts");
    writeRepoFile(dir, "src/gateway/server-methods/sessions.ts");
    writeRepoFile(dir, "src/gateway/server-methods.control-plane-rate-limit.test.ts");
    writeRepoFile(dir, "src/gateway/server/ws-connection/auth-messages.ts");
    writeRepoFile(dir, "src/auto-reply/reply/inbound-meta.test.ts");
    writeRepoFile(dir, "src/auto-reply/command-control.test.ts");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/gateway/protocol/client-info.ts",
      "src/gateway/server-methods/sessions.ts",
      "src/gateway/server-methods.control-plane-rate-limit.test.ts",
      "src/gateway/server/ws-connection/auth-messages.ts",
      "src/auto-reply/reply/inbound-meta.test.ts",
      "src/auto-reply/command-control.test.ts",
      "src/config/paths.ts",
    ]);

    const controlUiOutput = runAudit(dir, ["--group", "B", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    expect(controlUiOutput).toContain("Group B Landing Manifest");
    expect(controlUiOutput).toContain("src/gateway/protocol/client-info.ts");
    expect(controlUiOutput).toContain("src/gateway/server-methods/sessions.ts");
    expect(controlUiOutput).toContain(
      "src/gateway/server-methods.control-plane-rate-limit.test.ts",
    );
    expect(controlUiOutput).toContain("src/gateway/server/ws-connection/auth-messages.ts");
    expect(controlUiOutput).toContain("src/auto-reply/reply/inbound-meta.test.ts");
    expect(controlUiOutput).toContain("src/auto-reply/command-control.test.ts");
    expect(controlUiOutput).not.toContain("src/config/paths.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("src/gateway/protocol/client-info.ts");
  });

  it("keeps gateway chat payload compatibility inside group C", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/gateway/server-methods/chat.ts");
    writeRepoFile(dir, "src/gateway/server-methods/chat-scheduling.test.ts");
    writeRepoFile(dir, "src/gateway/server.chat.gateway-server-chat-b.test.ts");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/gateway/server-methods/chat.ts",
      "src/gateway/server-methods/chat-scheduling.test.ts",
      "src/gateway/server.chat.gateway-server-chat-b.test.ts",
      "src/config/paths.ts",
    ]);

    const chatCoreOutput = runAudit(dir, ["--group", "EDGSC", "--manifest"]);
    const runtimeOutput = runAudit(dir, ["--group", "C", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    // chat.ts is claimed by EDGSC ahead of C (first-match).
    expect(chatCoreOutput).toContain("Group EDGSC Landing Manifest");
    expect(chatCoreOutput).toContain("src/gateway/server-methods/chat.ts");
    expect(runtimeOutput).toContain("Group C Landing Manifest");
    expect(runtimeOutput).toContain("src/gateway/server-methods/chat-scheduling.test.ts");
    expect(runtimeOutput).toContain("src/gateway/server.chat.gateway-server-chat-b.test.ts");
    expect(runtimeOutput).not.toContain("src/gateway/server-methods/chat.ts");
    expect(runtimeOutput).not.toContain("src/config/paths.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("src/gateway/server-methods/chat.ts");
  });

  it("keeps cross-surface compatibility shims out of runtime and state groups", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/android/app/src/main/java/ai/openclaw/app/ui/CanvasScreen.kt");
    writeRepoFile(dir, "src/discord/components.ts");
    writeRepoFile(dir, "src/hooks/internal-hooks.ts");
    writeRepoFile(dir, "src/memory/qmd-manager.ts");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "apps/android/app/src/main/java/ai/openclaw/app/ui/CanvasScreen.kt",
      "src/discord/components.ts",
      "src/hooks/internal-hooks.ts",
      "src/memory/qmd-manager.ts",
      "src/config/paths.ts",
    ]);

    const compatOutput = runAudit(dir, ["--group", "H4", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);
    const runtimeOutput = runAudit(dir, ["--group", "C", "--manifest"]);

    expect(compatOutput).toContain("Group H4 Landing Manifest");
    expect(compatOutput).toContain(
      "apps/android/app/src/main/java/ai/openclaw/app/ui/CanvasScreen.kt",
    );
    expect(compatOutput).toContain("src/discord/components.ts");
    expect(compatOutput).toContain("src/hooks/internal-hooks.ts");
    expect(compatOutput).toContain("src/memory/qmd-manager.ts");
    expect(compatOutput).not.toContain("src/config/paths.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("src/memory/qmd-manager.ts");
    expect(runtimeOutput).not.toContain("src/discord/components.ts");
  });

  // The OpenClawKit *package* dir kept its name, but its inner targets were renamed
  // (Sources/OpenClawKit -> Sources/OpenBotKit, Tests/OpenClawKitTests -> Tests/OpenBotKitTests;
  // the OpenClaw* names survive only as thin *Compat targets). H4 declares the real
  // post-rename paths, so the pre-rename ones could never match H4 and fell through to
  // HMAC's catch-all apps/shared/OpenClawKit/**. Fixed by asserting paths that exist (W5) —
  // a stale-fact correction, not an ownership change: the rule table was already right.
  it("keeps client-id and device-auth compatibility inside H4", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/ios/ShareExtension/ShareViewController.swift");
    writeRepoFile(dir, "apps/shared/OpenClawKit/Sources/OpenBotKit/GatewayChannel.swift");
    writeRepoFile(
      dir,
      "apps/shared/OpenClawKit/Tests/OpenBotKitTests/DeviceAuthPayloadTests.swift",
    );
    writeRepoFile(dir, "src/gateway/device-auth.test.ts");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "apps/ios/ShareExtension/ShareViewController.swift",
      "apps/shared/OpenClawKit/Sources/OpenBotKit/GatewayChannel.swift",
      "apps/shared/OpenClawKit/Tests/OpenBotKitTests/DeviceAuthPayloadTests.swift",
      "src/gateway/device-auth.test.ts",
      "src/config/paths.ts",
    ]);

    const compatOutput = runAudit(dir, ["--group", "H4", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    expect(compatOutput).toContain("Group H4 Landing Manifest");
    expect(compatOutput).toContain("apps/ios/ShareExtension/ShareViewController.swift");
    expect(compatOutput).toContain(
      "apps/shared/OpenClawKit/Sources/OpenBotKit/GatewayChannel.swift",
    );
    expect(compatOutput).toContain(
      "apps/shared/OpenClawKit/Tests/OpenBotKitTests/DeviceAuthPayloadTests.swift",
    );
    expect(compatOutput).toContain("src/gateway/device-auth.test.ts");
    expect(compatOutput).not.toContain("src/config/paths.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("src/gateway/device-auth.test.ts");
  });

  it("keeps app shell discovery and settings separate from app canvas runtime", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/ios/Sources/Gateway/GatewayDiscoveryModel.swift");
    writeRepoFile(dir, "apps/macos/Sources/OpenBot/GatewayDiscoveryMenu.swift");
    writeRepoFile(dir, "apps/ios/Sources/Model/NodeAppModel.swift");
    run(dir, "git", [
      "add",
      "--",
      "apps/ios/Sources/Gateway/GatewayDiscoveryModel.swift",
      "apps/macos/Sources/OpenBot/GatewayDiscoveryMenu.swift",
      "apps/ios/Sources/Model/NodeAppModel.swift",
    ]);

    const appShellOutput = runAudit(dir, ["--group", "H6", "--manifest"]);
    const hmacOutput = runAudit(dir, ["--group", "HMAC", "--manifest"]);
    const canvasOutput = runAudit(dir, ["--group", "H5B2", "--manifest"]);

    expect(appShellOutput).toContain("Group H6 Landing Manifest");
    expect(appShellOutput).toContain("apps/ios/Sources/Gateway/GatewayDiscoveryModel.swift");
    expect(appShellOutput).not.toContain("apps/macos/Sources/OpenBot/GatewayDiscoveryMenu.swift");
    expect(appShellOutput).not.toContain("apps/ios/Sources/Model/NodeAppModel.swift");
    expect(hmacOutput).toContain("Group HMAC Landing Manifest");
    expect(hmacOutput).toContain("apps/macos/Sources/OpenBot/GatewayDiscoveryMenu.swift");
    expect(canvasOutput).toContain("Group H5B2 Landing Manifest");
    expect(canvasOutput).toContain("apps/ios/Sources/Model/NodeAppModel.swift");
    expect(canvasOutput).not.toContain("apps/macos/Sources/OpenBot/GatewayDiscoveryMenu.swift");
  });

  it("keeps extension, release scripts, and runtime tail paths out of unmatched", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "extensions/wecom/src/channel.ts");
    writeRepoFile(dir, "scripts/release-check.ts");
    writeRepoFile(dir, "src/tui/tui.ts");
    run(dir, "git", [
      "add",
      "--",
      "extensions/wecom/src/channel.ts",
      "scripts/release-check.ts",
      "src/tui/tui.ts",
    ]);

    // extensions/wecom/** is owned by the registry-native WPL stream: its
    // specific glob beats H1H's generic extensions/** (specific-before-general).
    // WPL exists only in the Registry, so under the legacy fallback wecom still
    // lands in H1H. Assert the owning stream per mode (W5 tier-2B; the one
    // assertion a real new stream, WPL, legitimately superseded).
    const wecomGroup = process.env.LOOM_FORCE_LEGACY === "1" ? "H1H" : "WPL";
    const extensionOutput = runAudit(dir, ["--group", wecomGroup, "--manifest"]);
    const releaseOutput = runAudit(dir, ["--group", "H1I2", "--manifest"]);
    const runtimeTailOutput = runAudit(dir, ["--group", "H1J", "--manifest"]);

    expect(extensionOutput).toContain(`Group ${wecomGroup} Landing Manifest`);
    expect(extensionOutput).toContain("extensions/wecom/src/channel.ts");
    expect(extensionOutput).not.toContain("scripts/release-check.ts");
    expect(releaseOutput).toContain("Group H1I2 Landing Manifest");
    expect(releaseOutput).toContain("scripts/release-check.ts");
    expect(releaseOutput).not.toContain("src/tui/tui.ts");
    expect(runtimeTailOutput).toContain("Group H1J Landing Manifest");
    expect(runtimeTailOutput).toContain("src/tui/tui.ts");
    expect(runtimeTailOutput).not.toContain("extensions/wecom/src/channel.ts");
  });

  it("keeps mac build artifacts in generated cleanup and iOS signing files split by canonical identity vs local helpers", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/macos/.build/build.db");
    writeRepoFile(dir, "apps/ios/Signing.xcconfig");
    writeRepoFile(dir, "apps/ios/LocalSigning.xcconfig.example");
    writeRepoFile(dir, "scripts/ios-configure-signing.sh");
    run(dir, "git", [
      "add",
      "--",
      "apps/macos/.build/build.db",
      "apps/ios/Signing.xcconfig",
      "apps/ios/LocalSigning.xcconfig.example",
      "scripts/ios-configure-signing.sh",
    ]);

    const generatedOutput = runAudit(dir, ["--group", "G", "--manifest"]);
    const configIdentityOutput = runAudit(dir, ["--group", "H1I1B1A1A", "--manifest"]);
    const manualIdentityOutput = runAudit(dir, ["--group", "H1I1B1A1B", "--manifest"]);
    const localExampleOutput = runAudit(dir, ["--group", "H1I1B1A2", "--manifest"]);
    const betaPrepareOutput = runAudit(dir, ["--group", "H1I1B1B1", "--manifest"]);
    const bundleIdPrintOutput = runAudit(dir, ["--group", "H1I1B1B2", "--manifest"]);
    const helperOutput = runAudit(dir, ["--group", "H1I1B2", "--manifest"]);

    expect(generatedOutput).toContain("Group G Landing Manifest");
    expect(generatedOutput).toContain("apps/macos/.build/build.db");
    expect(generatedOutput).not.toContain("apps/ios/Signing.xcconfig");
    expect(configIdentityOutput).toContain("Group H1I1B1A1A Landing Manifest");
    expect(configIdentityOutput).not.toContain("apps/ios/Signing.xcconfig");
    expect(configIdentityOutput).not.toContain("apps/ios/LocalSigning.xcconfig.example");
    expect(manualIdentityOutput).toContain("Group H1I1B1A1B Landing Manifest");
    expect(manualIdentityOutput).toContain("apps/ios/Signing.xcconfig");
    expect(manualIdentityOutput).not.toContain("apps/ios/LocalSigning.xcconfig.example");
    expect(localExampleOutput).toContain("Group H1I1B1A2 Landing Manifest");
    expect(localExampleOutput).toContain("apps/ios/LocalSigning.xcconfig.example");
    expect(localExampleOutput).not.toContain("apps/ios/Signing.xcconfig");
    expect(manualIdentityOutput).not.toContain("scripts/ios-configure-signing.sh");
    expect(betaPrepareOutput).toContain("Group H1I1B1B1 Landing Manifest");
    expect(betaPrepareOutput).not.toContain("apps/ios/Signing.xcconfig");
    expect(bundleIdPrintOutput).toContain("Group H1I1B1B2 Landing Manifest");
    expect(bundleIdPrintOutput).not.toContain("apps/ios/Signing.xcconfig");
    expect(helperOutput).toContain("Group H1I1B2 Landing Manifest");
    expect(helperOutput).toContain("scripts/ios-configure-signing.sh");
    expect(helperOutput).not.toContain("apps/ios/Signing.xcconfig");
    expect(helperOutput).not.toContain("apps/macos/.build/build.db");
  });

  it("keeps Android package identity and iOS local signing helpers separate from release distribution scripts", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/android/app/build.gradle.kts");
    writeRepoFile(dir, "scripts/ios-configure-signing.sh");
    writeRepoFile(dir, "scripts/package-mac-app.sh");
    run(dir, "git", [
      "add",
      "--",
      "apps/android/app/build.gradle.kts",
      "scripts/ios-configure-signing.sh",
      "scripts/package-mac-app.sh",
    ]);

    const androidAppOutput = runAudit(dir, ["--group", "H1I1A1", "--manifest"]);
    const androidBenchmarkOutput = runAudit(dir, ["--group", "H1I1A2", "--manifest"]);
    const iosHelperOutput = runAudit(dir, ["--group", "H1I1B2", "--manifest"]);
    const releaseOutput = runAudit(dir, ["--group", "H1I2", "--manifest"]);

    expect(androidAppOutput).toContain("Group H1I1A1 Landing Manifest");
    expect(androidAppOutput).toContain("apps/android/app/build.gradle.kts");
    expect(androidAppOutput).not.toContain("scripts/ios-configure-signing.sh");
    expect(androidBenchmarkOutput).toContain("Group H1I1A2 Landing Manifest");
    expect(androidBenchmarkOutput).not.toContain("apps/android/app/build.gradle.kts");
    expect(iosHelperOutput).toContain("Group H1I1B2 Landing Manifest");
    expect(iosHelperOutput).toContain("scripts/ios-configure-signing.sh");
    expect(iosHelperOutput).not.toContain("apps/android/benchmark/build.gradle.kts");
    expect(releaseOutput).toContain("Group H1I2 Landing Manifest");
    expect(releaseOutput).toContain("scripts/package-mac-app.sh");
    expect(releaseOutput).not.toContain("apps/android/app/build.gradle.kts");
  });

  it("keeps Android app identity separate from Android benchmark identity and manual iOS signing xcconfig identity", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/android/app/build.gradle.kts");
    writeRepoFile(dir, "apps/android/benchmark/build.gradle.kts");
    writeRepoFile(dir, "apps/ios/Signing.xcconfig");
    writeRepoFile(dir, "scripts/ios-beta-prepare.sh");
    run(dir, "git", [
      "add",
      "--",
      "apps/android/app/build.gradle.kts",
      "apps/android/benchmark/build.gradle.kts",
      "apps/ios/Signing.xcconfig",
      "scripts/ios-beta-prepare.sh",
    ]);

    const androidAppOutput = runAudit(dir, ["--group", "H1I1A1", "--manifest"]);
    const androidBenchmarkOutput = runAudit(dir, ["--group", "H1I1A2", "--manifest"]);
    const iosIdentityOutput = runAudit(dir, ["--group", "H1I1B1A1B", "--manifest"]);

    expect(androidAppOutput).toContain("Group H1I1A1 Landing Manifest");
    expect(androidAppOutput).toContain("apps/android/app/build.gradle.kts");
    expect(androidAppOutput).not.toContain("apps/android/benchmark/build.gradle.kts");
    expect(androidBenchmarkOutput).toContain("Group H1I1A2 Landing Manifest");
    expect(androidBenchmarkOutput).toContain("apps/android/benchmark/build.gradle.kts");
    expect(androidBenchmarkOutput).not.toContain("apps/ios/Signing.xcconfig");
    expect(iosIdentityOutput).toContain("Group H1I1B1A1B Landing Manifest");
    expect(iosIdentityOutput).toContain("apps/ios/Signing.xcconfig");
    expect(iosIdentityOutput).not.toContain("scripts/ios-beta-prepare.sh");
    expect(iosIdentityOutput).not.toContain("apps/android/app/build.gradle.kts");
  });

  it("keeps config and manual iOS xcconfig identity separate from local example, beta prepare, bundle-id print, and local signing helpers", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/ios/Config/Signing.xcconfig");
    writeRepoFile(dir, "apps/ios/Signing.xcconfig");
    writeRepoFile(dir, "apps/ios/LocalSigning.xcconfig.example");
    writeRepoFile(dir, "scripts/ios-beta-prepare.sh");
    writeRepoFile(dir, "scripts/ios-configure-signing.sh");
    writeRepoFile(dir, "scripts/ios-print-app-bundle-id.sh");
    run(dir, "git", [
      "add",
      "--",
      "apps/ios/Config/Signing.xcconfig",
      "apps/ios/Signing.xcconfig",
      "apps/ios/LocalSigning.xcconfig.example",
      "scripts/ios-beta-prepare.sh",
      "scripts/ios-configure-signing.sh",
      "scripts/ios-print-app-bundle-id.sh",
    ]);

    const iosConfigIdentityOutput = runAudit(dir, ["--group", "H1I1B1A1A", "--manifest"]);
    const iosManualIdentityOutput = runAudit(dir, ["--group", "H1I1B1A1B", "--manifest"]);
    const iosLocalExampleOutput = runAudit(dir, ["--group", "H1I1B1A2", "--manifest"]);
    const iosBetaPrepareOutput = runAudit(dir, ["--group", "H1I1B1B1", "--manifest"]);
    const iosBundleIdPrintOutput = runAudit(dir, ["--group", "H1I1B1B2", "--manifest"]);
    const iosHelperOutput = runAudit(dir, ["--group", "H1I1B2", "--manifest"]);

    expect(iosConfigIdentityOutput).toContain("Group H1I1B1A1A Landing Manifest");
    expect(iosConfigIdentityOutput).toContain("apps/ios/Config/Signing.xcconfig");
    expect(iosConfigIdentityOutput).not.toContain("apps/ios/Signing.xcconfig");
    expect(iosConfigIdentityOutput).not.toContain("scripts/ios-beta-prepare.sh");
    expect(iosManualIdentityOutput).toContain("Group H1I1B1A1B Landing Manifest");
    expect(iosManualIdentityOutput).toContain("apps/ios/Signing.xcconfig");
    expect(iosManualIdentityOutput).not.toContain("apps/ios/Config/Signing.xcconfig");
    expect(iosManualIdentityOutput).not.toContain("scripts/ios-configure-signing.sh");
    expect(iosLocalExampleOutput).toContain("Group H1I1B1A2 Landing Manifest");
    expect(iosLocalExampleOutput).toContain("apps/ios/LocalSigning.xcconfig.example");
    expect(iosLocalExampleOutput).not.toContain("apps/ios/Signing.xcconfig");
    expect(iosBetaPrepareOutput).toContain("Group H1I1B1B1 Landing Manifest");
    expect(iosBetaPrepareOutput).toContain("scripts/ios-beta-prepare.sh");
    expect(iosBetaPrepareOutput).not.toContain("scripts/ios-print-app-bundle-id.sh");
    expect(iosBetaPrepareOutput).not.toContain("apps/ios/Signing.xcconfig");
    expect(iosBundleIdPrintOutput).toContain("Group H1I1B1B2 Landing Manifest");
    expect(iosBundleIdPrintOutput).toContain("scripts/ios-print-app-bundle-id.sh");
    expect(iosBundleIdPrintOutput).not.toContain("scripts/ios-beta-prepare.sh");
    expect(iosBundleIdPrintOutput).not.toContain("apps/ios/Signing.xcconfig");
    expect(iosHelperOutput).toContain("Group H1I1B2 Landing Manifest");
    expect(iosHelperOutput).toContain("scripts/ios-configure-signing.sh");
    expect(iosHelperOutput).not.toContain("apps/ios/Signing.xcconfig");
    expect(iosHelperOutput).not.toContain("scripts/ios-print-app-bundle-id.sh");
  });

  it("keeps Android benchmark identity files together and out of the main app identity group", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/android/app/build.gradle.kts");
    writeRepoFile(dir, "apps/android/benchmark/build.gradle.kts");
    writeRepoFile(
      dir,
      "apps/android/benchmark/src/main/java/ai/openclaw/app/benchmark/StartupMacrobenchmark.kt",
    );
    writeRepoFile(dir, "apps/android/scripts/perf-startup-benchmark.sh");
    run(dir, "git", [
      "add",
      "--",
      "apps/android/app/build.gradle.kts",
      "apps/android/benchmark/build.gradle.kts",
      "apps/android/benchmark/src/main/java/ai/openclaw/app/benchmark/StartupMacrobenchmark.kt",
      "apps/android/scripts/perf-startup-benchmark.sh",
    ]);

    const appOutput = runAudit(dir, ["--group", "H1I1A1", "--manifest"]);
    const benchmarkOutput = runAudit(dir, ["--group", "H1I1A2", "--manifest"]);

    expect(appOutput).toContain("Group H1I1A1 Landing Manifest");
    expect(appOutput).toContain("apps/android/app/build.gradle.kts");
    expect(appOutput).not.toContain("apps/android/benchmark/build.gradle.kts");
    expect(benchmarkOutput).toContain("Group H1I1A2 Landing Manifest");
    expect(benchmarkOutput).toContain("apps/android/benchmark/build.gradle.kts");
    expect(benchmarkOutput).toContain(
      "apps/android/benchmark/src/main/java/ai/openclaw/app/benchmark/StartupMacrobenchmark.kt",
    );
    expect(benchmarkOutput).toContain("apps/android/scripts/perf-startup-benchmark.sh");
    expect(benchmarkOutput).not.toContain("apps/android/app/build.gradle.kts");
  });

  it("keeps openbot vision and UI migration notes inside analysis docs", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "OpenBot-Vision.md");
    writeRepoFile(dir, "docs/design/openbot-openclaw-ui-capability-migration-plan-2026-04-10.md");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "OpenBot-Vision.md",
      "docs/design/openbot-openclaw-ui-capability-migration-plan-2026-04-10.md",
      "src/config/paths.ts",
    ]);

    const analysisOutput = runAudit(dir, ["--group", "F", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    expect(analysisOutput).toContain("Group F Landing Manifest");
    expect(analysisOutput).toContain("OpenBot-Vision.md");
    expect(analysisOutput).toContain(
      "docs/design/openbot-openclaw-ui-capability-migration-plan-2026-04-10.md",
    );
    expect(analysisOutput).not.toContain("src/config/paths.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("OpenBot-Vision.md");
  });

  it("keeps four-port IA notes and shared domain prototypes inside analysis docs", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "docs/design/openbot-four-port-ia-and-reorg-plan-2026-04-12.md");
    writeRepoFile(dir, "src/shared/domain/agent.ts");
    writeRepoFile(dir, "ui/index.html");
    run(dir, "git", [
      "add",
      "--",
      "docs/design/openbot-four-port-ia-and-reorg-plan-2026-04-12.md",
      "src/shared/domain/agent.ts",
      "ui/index.html",
    ]);

    const analysisOutput = runAudit(dir, ["--group", "F", "--manifest"]);
    const uiOutput = runAudit(dir, ["--group", "A", "--manifest"]);

    expect(analysisOutput).toContain("Group F Landing Manifest");
    expect(analysisOutput).toContain(
      "docs/design/openbot-four-port-ia-and-reorg-plan-2026-04-12.md",
    );
    expect(analysisOutput).toContain("src/shared/domain/agent.ts");
    expect(analysisOutput).not.toContain("ui/index.html");
    expect(uiOutput).toContain("Group A Landing Manifest");
    expect(uiOutput).toContain("ui/index.html");
    expect(uiOutput).not.toContain("src/shared/domain/agent.ts");
  });

  // Same post-rename path correction as the device-auth case above (W5).
  it("keeps shared app compatibility and deep-link security files inside H4", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/shared/OpenClawKit/Sources/OpenBotKit/DeepLinks.swift");
    writeRepoFile(dir, "apps/shared/OpenClawKit/Sources/OpenBotKit/GatewayNodeSession.swift");
    writeRepoFile(dir, "apps/android/app/src/main/java/ai/openclaw/app/gateway/GatewaySession.kt");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "apps/shared/OpenClawKit/Sources/OpenBotKit/DeepLinks.swift",
      "apps/shared/OpenClawKit/Sources/OpenBotKit/GatewayNodeSession.swift",
      "apps/android/app/src/main/java/ai/openclaw/app/gateway/GatewaySession.kt",
      "src/config/paths.ts",
    ]);

    const compatOutput = runAudit(dir, ["--group", "H4", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    expect(compatOutput).toContain("Group H4 Landing Manifest");
    expect(compatOutput).toContain("apps/shared/OpenClawKit/Sources/OpenBotKit/DeepLinks.swift");
    expect(compatOutput).toContain(
      "apps/shared/OpenClawKit/Sources/OpenBotKit/GatewayNodeSession.swift",
    );
    expect(compatOutput).toContain(
      "apps/android/app/src/main/java/ai/openclaw/app/gateway/GatewaySession.kt",
    );
    expect(compatOutput).not.toContain("src/config/paths.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("apps/shared/OpenClawKit/Sources/OpenBotKit/DeepLinks.swift");
  });

  it("keeps channel docs with operator guidance and service discovery aliases with runtime identity", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "docs/channels/discord.md");
    writeRepoFile(dir, "src/infra/bonjour-discovery.ts");
    writeRepoFile(dir, "src/infra/widearea-dns.ts");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "docs/channels/discord.md",
      "src/infra/bonjour-discovery.ts",
      "src/infra/widearea-dns.ts",
      "src/config/paths.ts",
    ]);

    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);
    const identityOutput = runAudit(dir, ["--group", "H1F", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("docs/channels/discord.md");
    expect(operatorOutput).not.toContain("src/infra/bonjour-discovery.ts");
    expect(identityOutput).toContain("Group H1F Landing Manifest");
    expect(identityOutput).toContain("src/infra/bonjour-discovery.ts");
    expect(identityOutput).toContain("src/infra/widearea-dns.ts");
    expect(identityOutput).not.toContain("src/config/paths.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("docs/channels/discord.md");
  });

  it("keeps channel docs in operator guidance and gateway/install docs in runtime guides", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "docs/channels/bluebubbles.md");
    writeRepoFile(dir, "docs/gateway/bonjour.md");
    writeRepoFile(dir, "docs/install/updating.md");
    run(dir, "git", [
      "add",
      "--",
      "docs/channels/bluebubbles.md",
      "docs/gateway/bonjour.md",
      "docs/install/updating.md",
    ]);

    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);
    const guideOutput = runAudit(dir, ["--group", "I", "--manifest"]);

    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("docs/channels/bluebubbles.md");
    expect(operatorOutput).not.toContain("docs/gateway/bonjour.md");
    expect(guideOutput).toContain("Group I Landing Manifest");
    expect(guideOutput).toContain("docs/gateway/bonjour.md");
    expect(guideOutput).toContain("docs/install/updating.md");
    expect(guideOutput).not.toContain("docs/channels/bluebubbles.md");
  });

  it("keeps app compatibility shims separate from app shell naming and push identity tests", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/ios/Sources/Gateway/GatewaySettingsStore.swift");
    writeRepoFile(dir, "apps/ios/Sources/Chat/IOSGatewayChatTransport.swift");
    writeRepoFile(dir, "src/infra/push-apns.test.ts");
    run(dir, "git", [
      "add",
      "--",
      "apps/ios/Sources/Gateway/GatewaySettingsStore.swift",
      "apps/ios/Sources/Chat/IOSGatewayChatTransport.swift",
      "src/infra/push-apns.test.ts",
    ]);

    const compatOutput = runAudit(dir, ["--group", "H4", "--manifest"]);
    const shellOutput = runAudit(dir, ["--group", "H6", "--manifest"]);
    const identityOutput = runAudit(dir, ["--group", "H1F", "--manifest"]);

    expect(compatOutput).toContain("Group H4 Landing Manifest");
    expect(compatOutput).toContain("apps/ios/Sources/Gateway/GatewaySettingsStore.swift");
    expect(compatOutput).not.toContain("apps/ios/Sources/Chat/IOSGatewayChatTransport.swift");
    expect(shellOutput).toContain("Group H6 Landing Manifest");
    expect(shellOutput).toContain("apps/ios/Sources/Chat/IOSGatewayChatTransport.swift");
    expect(shellOutput).not.toContain("src/infra/push-apns.test.ts");
    expect(identityOutput).toContain("Group H1F Landing Manifest");
    expect(identityOutput).toContain("src/infra/push-apns.test.ts");
    expect(identityOutput).not.toContain("apps/ios/Sources/Gateway/GatewaySettingsStore.swift");
  });

  it("keeps doctor and operator guidance separate from daemon and state groups", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/commands/doctor.ts");
    writeRepoFile(dir, "src/commands/gateway-install-token.ts");
    writeRepoFile(dir, "src/infra/restart-sentinel.ts");
    writeRepoFile(dir, "src/daemon/service-env.ts");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/commands/doctor.ts",
      "src/commands/gateway-install-token.ts",
      "src/infra/restart-sentinel.ts",
      "src/daemon/service-env.ts",
      "src/config/paths.ts",
    ]);

    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);
    const daemonOutput = runAudit(dir, ["--group", "H1C", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/commands/doctor.ts");
    expect(operatorOutput).toContain("src/commands/gateway-install-token.ts");
    expect(operatorOutput).toContain("src/infra/restart-sentinel.ts");
    expect(operatorOutput).not.toContain("src/daemon/service-env.ts");
    expect(daemonOutput).toContain("Group H1C Landing Manifest");
    expect(daemonOutput).toContain("src/daemon/service-env.ts");
    expect(daemonOutput).not.toContain("src/commands/doctor.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("src/infra/restart-sentinel.ts");
  });

  it("keeps state integrity and exec approval paths inside H2", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/commands/doctor-state-integrity.ts");
    writeRepoFile(dir, "src/infra/exec-approvals.ts");
    writeRepoFile(dir, "src/commands/doctor-auth.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/commands/doctor-state-integrity.ts",
      "src/infra/exec-approvals.ts",
      "src/commands/doctor-auth.ts",
    ]);

    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);
    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);

    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/commands/doctor-state-integrity.ts");
    expect(stateOutput).toContain("src/infra/exec-approvals.ts");
    expect(stateOutput).not.toContain("src/commands/doctor-auth.ts");
    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/commands/doctor-auth.ts");
    expect(operatorOutput).not.toContain("src/infra/exec-approvals.ts");
  });

  it("keeps install and completion verification scripts in their respective surfaces", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "scripts/docker/install-sh-e2e/run.sh");
    writeRepoFile(dir, "scripts/test-shell-completion.ts");
    run(dir, "git", [
      "add",
      "--",
      "scripts/docker/install-sh-e2e/run.sh",
      "scripts/test-shell-completion.ts",
    ]);

    const installOutput = runAudit(dir, ["--group", "H1A1B", "--manifest"]);
    const completionOutput = runAudit(dir, ["--group", "H1A2A", "--manifest"]);

    expect(installOutput).toContain("Group H1A1B Landing Manifest");
    expect(installOutput).toContain("scripts/docker/install-sh-e2e/run.sh");
    expect(installOutput).not.toContain("scripts/test-shell-completion.ts");
    expect(completionOutput).toContain("Group H1A2A Landing Manifest");
    expect(completionOutput).toContain("scripts/test-shell-completion.ts");
    expect(completionOutput).not.toContain("scripts/docker/install-sh-e2e/run.sh");
  });

  it("keeps package entry identity separate from shell installer scripts", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "openbot.mjs");
    writeRepoFile(dir, "package.json", "{}\n");
    writeRepoFile(dir, "src/infra/path-env.ts");
    writeRepoFile(dir, "scripts/install.sh");
    run(dir, "git", [
      "add",
      "--",
      "openbot.mjs",
      "package.json",
      "src/infra/path-env.ts",
      "scripts/install.sh",
    ]);

    const metadataOutput = runAudit(dir, ["--group", "H1A0A2B", "--manifest"]);
    const aorOutput = runAudit(dir, ["--group", "AOR", "--manifest"]);
    const pathOutput = runAudit(dir, ["--group", "H1A0B2", "--manifest"]);
    const installerOutput = runAudit(dir, ["--group", "H1A1A", "--manifest"]);

    expect(metadataOutput).toContain("Group H1A0A2B Landing Manifest");
    expect(metadataOutput).not.toContain("package.json");
    expect(aorOutput).toContain("Group AOR Landing Manifest");
    expect(aorOutput).toContain("package.json");
    expect(aorOutput).not.toContain("openbot.mjs");
    expect(pathOutput).toContain("Group H1A0B2 Landing Manifest");
    expect(pathOutput).toContain("src/infra/path-env.ts");
    expect(pathOutput).not.toContain("openbot.mjs");
    expect(pathOutput).not.toContain("package.json");
    expect(pathOutput).not.toContain("scripts/install.sh");
    expect(installerOutput).toContain("Group H1A1A Landing Manifest");
    expect(installerOutput).toContain("scripts/install.sh");
    expect(installerOutput).not.toContain("package.json");
  });

  it("keeps README package install naming separate from package metadata while cli wrappers stay in entry compatibility", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "README.md");
    writeRepoFile(dir, "openbot.mjs");
    writeRepoFile(dir, "scripts/install.sh");
    run(dir, "git", ["add", "--", "README.md", "openbot.mjs", "scripts/install.sh"]);

    const readmeOutput = runAudit(dir, ["--group", "H1A0A1", "--manifest"]);
    const wrapperOutput = runAudit(dir, ["--group", "H1A0B1", "--manifest"]);
    const installerOutput = runAudit(dir, ["--group", "H1A1A", "--manifest"]);

    expect(readmeOutput).toContain("Group H1A0A1 Landing Manifest");
    expect(readmeOutput).toContain("README.md");
    expect(readmeOutput).not.toContain("openbot.mjs");
    expect(wrapperOutput).toContain("Group H1A0B1 Landing Manifest");
    expect(wrapperOutput).toContain("openbot.mjs");
    expect(wrapperOutput).not.toContain("README.md");
    expect(wrapperOutput).not.toContain("scripts/install.sh");
    expect(installerOutput).toContain("Group H1A1A Landing Manifest");
    expect(installerOutput).toContain("scripts/install.sh");
    expect(installerOutput).not.toContain("README.md");
  });

  it("keeps shell installer separate from windows and e2e installer support", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "scripts/install.sh");
    writeRepoFile(dir, "scripts/install.ps1");
    writeRepoFile(dir, "scripts/docker/install-sh-e2e/run.sh");
    run(dir, "git", [
      "add",
      "--",
      "scripts/install.sh",
      "scripts/install.ps1",
      "scripts/docker/install-sh-e2e/run.sh",
    ]);

    const shellOutput = runAudit(dir, ["--group", "H1A1A", "--manifest"]);
    const supportOutput = runAudit(dir, ["--group", "H1A1B", "--manifest"]);

    expect(shellOutput).toContain("Group H1A1A Landing Manifest");
    expect(shellOutput).toContain("scripts/install.sh");
    expect(shellOutput).not.toContain("scripts/install.ps1");
    expect(supportOutput).toContain("Group H1A1B Landing Manifest");
    expect(supportOutput).toContain("scripts/install.ps1");
    expect(supportOutput).toContain("scripts/docker/install-sh-e2e/run.sh");
    expect(supportOutput).not.toContain("scripts/install.sh");
  });

  it("keeps help and lifecycle tests with their owning compatibility surfaces", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/cli/daemon-cli/lifecycle.test.ts");
    writeRepoFile(dir, "src/cli/update-cli.test.ts");
    writeRepoFile(dir, "src/cli/memory-cli.test.ts");
    writeRepoFile(dir, "src/commands/doctor-memory-search.test.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/cli/daemon-cli/lifecycle.test.ts",
      "src/cli/update-cli.test.ts",
      "src/cli/memory-cli.test.ts",
      "src/commands/doctor-memory-search.test.ts",
    ]);

    const daemonOutput = runAudit(dir, ["--group", "H1C", "--manifest"]);
    const updateExecOutput = runAudit(dir, ["--group", "H1A2C", "--manifest"]);
    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);

    expect(daemonOutput).toContain("Group H1C Landing Manifest");
    expect(daemonOutput).toContain("src/cli/daemon-cli/lifecycle.test.ts");
    expect(daemonOutput).not.toContain("src/cli/update-cli.test.ts");
    expect(updateExecOutput).toContain("Group H1A2C Landing Manifest");
    expect(updateExecOutput).toContain("src/cli/update-cli.test.ts");
    expect(updateExecOutput).not.toContain("src/cli/memory-cli.test.ts");
    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/cli/memory-cli.test.ts");
    expect(operatorOutput).toContain("src/commands/doctor-memory-search.test.ts");
    expect(operatorOutput).not.toContain("src/cli/daemon-cli/lifecycle.test.ts");
  });

  it("keeps cli command strings with H1B1 while generated vite cache stays in G", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/cli/browser-cli.ts");
    writeRepoFile(dir, "src/cli/program/register.backup.ts");
    writeRepoFile(dir, "src/entry.ts");
    writeRepoFile(
      dir,
      "ui/node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json",
    );
    writeRepoFile(dir, "src/commands/onboard.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/cli/browser-cli.ts",
      "src/cli/program/register.backup.ts",
      "src/entry.ts",
      "ui/node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json",
      "src/commands/onboard.ts",
    ]);

    const cliOutput = runAudit(dir, ["--group", "H1B1", "--manifest"]);
    const generatedOutput = runAudit(dir, ["--group", "G", "--manifest"]);
    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);

    expect(cliOutput).toContain("Group H1B1 Landing Manifest");
    expect(cliOutput).toContain("src/cli/browser-cli.ts");
    expect(cliOutput).toContain("src/cli/program/register.backup.ts");
    expect(cliOutput).toContain("src/entry.ts");
    expect(cliOutput).not.toContain("src/commands/onboard.ts");
    expect(generatedOutput).toContain("Group G Landing Manifest");
    expect(generatedOutput).toContain(
      "ui/node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json",
    );
    expect(generatedOutput).not.toContain("src/entry.ts");
    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/commands/onboard.ts");
    expect(operatorOutput).not.toContain("src/cli/program/register.backup.ts");
  });

  it("keeps browser extension install copy with H1B1", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/cli/browser-cli-extension.ts");
    writeRepoFile(dir, "src/cli/gateway-cli/register.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/cli/browser-cli-extension.ts",
      "src/cli/gateway-cli/register.ts",
    ]);

    const cliOutput = runAudit(dir, ["--group", "H1B1", "--manifest"]);
    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);

    expect(cliOutput).toContain("Group H1B1 Landing Manifest");
    expect(cliOutput).toContain("src/cli/browser-cli-extension.ts");
    expect(cliOutput).not.toContain("src/cli/gateway-cli/register.ts");
    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/cli/gateway-cli/register.ts");
    expect(operatorOutput).not.toContain("src/cli/browser-cli-extension.ts");
  });

  it("keeps daemon lifecycle implementations and status help in their owning surfaces", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/cli/daemon-cli/lifecycle-core.ts");
    writeRepoFile(dir, "src/cli/daemon-cli/status.print.ts");
    writeRepoFile(dir, "src/cli/memory-cli.ts");
    writeRepoFile(dir, "src/commands/status.test.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/cli/daemon-cli/lifecycle-core.ts",
      "src/cli/daemon-cli/status.print.ts",
      "src/cli/memory-cli.ts",
      "src/commands/status.test.ts",
    ]);

    const daemonOutput = runAudit(dir, ["--group", "H1C", "--manifest"]);
    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);

    expect(daemonOutput).toContain("Group H1C Landing Manifest");
    expect(daemonOutput).toContain("src/cli/daemon-cli/lifecycle-core.ts");
    expect(daemonOutput).toContain("src/cli/daemon-cli/status.print.ts");
    expect(daemonOutput).not.toContain("src/cli/memory-cli.ts");
    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/cli/memory-cli.ts");
    expect(operatorOutput).toContain("src/commands/status.test.ts");
    expect(operatorOutput).not.toContain("src/cli/daemon-cli/status.print.ts");
  });

  it("keeps node daemon install flow separate from operator reset and uninstall guidance", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/cli/node-cli/register.ts");
    writeRepoFile(dir, "src/commands/daemon-install-helpers.ts");
    writeRepoFile(dir, "src/commands/reset.ts");
    writeRepoFile(dir, "src/commands/uninstall.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/cli/node-cli/register.ts",
      "src/commands/daemon-install-helpers.ts",
      "src/commands/reset.ts",
      "src/commands/uninstall.ts",
    ]);

    const daemonOutput = runAudit(dir, ["--group", "H1C", "--manifest"]);
    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);

    expect(daemonOutput).toContain("Group H1C Landing Manifest");
    expect(daemonOutput).toContain("src/cli/node-cli/register.ts");
    expect(daemonOutput).toContain("src/commands/daemon-install-helpers.ts");
    expect(daemonOutput).not.toContain("src/commands/reset.ts");
    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/commands/reset.ts");
    expect(operatorOutput).toContain("src/commands/uninstall.ts");
    expect(operatorOutput).not.toContain("src/cli/node-cli/register.ts");
  });

  it("keeps gateway run and daemon install wiring with H1C while operator tails stay in H1D", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/cli/daemon-cli/install.ts");
    writeRepoFile(dir, "src/cli/gateway-cli/run.ts");
    writeRepoFile(dir, "src/commands/docs.ts");
    writeRepoFile(dir, "src/channels/plugins/helpers.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/cli/daemon-cli/install.ts",
      "src/cli/gateway-cli/run.ts",
      "src/commands/docs.ts",
      "src/channels/plugins/helpers.ts",
    ]);

    const daemonOutput = runAudit(dir, ["--group", "H1C", "--manifest"]);
    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);

    expect(daemonOutput).toContain("Group H1C Landing Manifest");
    expect(daemonOutput).toContain("src/cli/daemon-cli/install.ts");
    expect(daemonOutput).toContain("src/cli/gateway-cli/run.ts");
    expect(daemonOutput).not.toContain("src/commands/docs.ts");
    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/commands/docs.ts");
    expect(operatorOutput).toContain("src/channels/plugins/helpers.ts");
    expect(operatorOutput).not.toContain("src/cli/gateway-cli/run.ts");
  });

  it("keeps browser temp paths separate from daemon restart support", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/browser/paths.ts");
    writeRepoFile(dir, "src/cli/browser-cli-debug.ts");
    writeRepoFile(dir, "src/infra/tmp-openclaw-dir.ts");
    writeRepoFile(dir, "src/infra/windows-task-restart.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/browser/paths.ts",
      "src/cli/browser-cli-debug.ts",
      "src/infra/tmp-openclaw-dir.ts",
      "src/infra/windows-task-restart.ts",
    ]);

    const browserOutput = runAudit(dir, ["--group", "H1E", "--manifest"]);
    const daemonOutput = runAudit(dir, ["--group", "H1C", "--manifest"]);

    expect(browserOutput).toContain("Group H1E Landing Manifest");
    expect(browserOutput).toContain("src/browser/paths.ts");
    expect(browserOutput).toContain("src/cli/browser-cli-debug.ts");
    expect(browserOutput).toContain("src/infra/tmp-openclaw-dir.ts");
    expect(browserOutput).not.toContain("src/infra/windows-task-restart.ts");
    expect(daemonOutput).toContain("Group H1C Landing Manifest");
    expect(daemonOutput).toContain("src/infra/windows-task-restart.ts");
    expect(daemonOutput).not.toContain("src/browser/paths.ts");
  });

  it("keeps runtime identity and branding copy separate from operator guidance and browser temp paths", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/agents/system-prompt.ts");
    writeRepoFile(dir, "src/agents/sandbox/validate-sandbox-security.ts");
    writeRepoFile(dir, "src/auto-reply/reply/commands-session.ts");
    writeRepoFile(dir, "src/browser/client-fetch.ts");
    writeRepoFile(dir, "src/cli/banner.ts");
    writeRepoFile(dir, "src/gateway/server-discovery.ts");
    writeRepoFile(dir, "src/logging/logger.ts");
    writeRepoFile(dir, "src/commands/docs.ts");
    writeRepoFile(dir, "src/browser/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/agents/system-prompt.ts",
      "src/agents/sandbox/validate-sandbox-security.ts",
      "src/auto-reply/reply/commands-session.ts",
      "src/browser/client-fetch.ts",
      "src/cli/banner.ts",
      "src/gateway/server-discovery.ts",
      "src/logging/logger.ts",
      "src/commands/docs.ts",
      "src/browser/paths.ts",
    ]);

    const brandingOutput = runAudit(dir, ["--group", "H1F", "--manifest"]);
    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);
    const browserOutput = runAudit(dir, ["--group", "H1E", "--manifest"]);

    expect(brandingOutput).toContain("Group H1F Landing Manifest");
    expect(brandingOutput).toContain("src/agents/system-prompt.ts");
    expect(brandingOutput).toContain("src/agents/sandbox/validate-sandbox-security.ts");
    expect(brandingOutput).toContain("src/auto-reply/reply/commands-session.ts");
    expect(brandingOutput).toContain("src/browser/client-fetch.ts");
    expect(brandingOutput).toContain("src/cli/banner.ts");
    expect(brandingOutput).toContain("src/gateway/server-discovery.ts");
    expect(brandingOutput).toContain("src/logging/logger.ts");
    expect(brandingOutput).not.toContain("src/commands/docs.ts");
    expect(brandingOutput).not.toContain("src/browser/paths.ts");
    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/commands/docs.ts");
    expect(operatorOutput).not.toContain("src/cli/banner.ts");
    expect(browserOutput).toContain("Group H1E Landing Manifest");
    expect(browserOutput).toContain("src/browser/paths.ts");
    expect(browserOutput).not.toContain("src/browser/client-fetch.ts");
  });

  it("keeps runtime support and integration tails separate from branding and operator guidance", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/browser/extension-relay.ts");
    writeRepoFile(dir, "src/hooks/loader.ts");
    writeRepoFile(dir, "src/security/audit.ts");
    writeRepoFile(dir, "src/commands/agent.test.ts");
    writeRepoFile(dir, "src/agents/system-prompt.ts");
    writeRepoFile(dir, "src/commands/docs.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/browser/extension-relay.ts",
      "src/hooks/loader.ts",
      "src/security/audit.ts",
      "src/commands/agent.test.ts",
      "src/agents/system-prompt.ts",
      "src/commands/docs.ts",
    ]);

    const supportOutput = runAudit(dir, ["--group", "H1G", "--manifest"]);
    const brandingOutput = runAudit(dir, ["--group", "H1F", "--manifest"]);
    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);

    expect(supportOutput).toContain("Group H1G Landing Manifest");
    expect(supportOutput).toContain("src/browser/extension-relay.ts");
    expect(supportOutput).toContain("src/hooks/loader.ts");
    expect(supportOutput).toContain("src/security/audit.ts");
    expect(supportOutput).toContain("src/commands/agent.test.ts");
    expect(supportOutput).not.toContain("src/agents/system-prompt.ts");
    expect(supportOutput).not.toContain("src/commands/docs.ts");
    expect(brandingOutput).toContain("Group H1F Landing Manifest");
    expect(brandingOutput).toContain("src/agents/system-prompt.ts");
    expect(brandingOutput).not.toContain("src/browser/extension-relay.ts");
    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/commands/docs.ts");
    expect(operatorOutput).not.toContain("src/security/audit.ts");
  });

  it("keeps control-ui docs, legacy compatibility names, and hook auth support in their owning groups", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "docs/web/control-ui.md");
    writeRepoFile(dir, "src/compat/legacy-names.ts");
    writeRepoFile(dir, "src/gateway/hooks.ts");
    writeRepoFile(dir, "src/gateway/server.hooks.test.ts");
    writeRepoFile(dir, "src/commands/docs.ts");
    writeRepoFile(dir, "src/security/audit.ts");
    run(dir, "git", [
      "add",
      "--",
      "docs/web/control-ui.md",
      "src/compat/legacy-names.ts",
      "src/gateway/hooks.ts",
      "src/gateway/server.hooks.test.ts",
      "src/commands/docs.ts",
      "src/security/audit.ts",
    ]);

    const controlUiOutput = runAudit(dir, ["--group", "B", "--manifest"]);
    const compatOutput = runAudit(dir, ["--group", "H4", "--manifest"]);
    const supportOutput = runAudit(dir, ["--group", "H1G", "--manifest"]);
    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);

    expect(controlUiOutput).toContain("Group B Landing Manifest");
    expect(controlUiOutput).toContain("docs/web/control-ui.md");
    expect(controlUiOutput).not.toContain("src/compat/legacy-names.ts");
    expect(compatOutput).toContain("Group H4 Landing Manifest");
    expect(compatOutput).toContain("src/compat/legacy-names.ts");
    expect(compatOutput).not.toContain("src/gateway/hooks.ts");
    expect(supportOutput).toContain("Group H1G Landing Manifest");
    expect(supportOutput).toContain("src/gateway/hooks.ts");
    expect(supportOutput).toContain("src/gateway/server.hooks.test.ts");
    expect(supportOutput).not.toContain("src/commands/docs.ts");
    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/commands/docs.ts");
    expect(operatorOutput).not.toContain("src/gateway/hooks.ts");
  });

  it("keeps branding, tmp-root, installer, and support test tails in their owning groups", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/acp/client.test.ts");
    writeRepoFile(dir, "src/agents/model-fallback.test.ts");
    writeRepoFile(dir, "src/agents/path-policy.test.ts");
    writeRepoFile(dir, "src/agents/sandbox-paths.test.ts");
    writeRepoFile(dir, "src/cli/program/register.agent.test.ts");
    writeRepoFile(dir, "src/cli/gateway-cli.coverage.test.ts");
    writeRepoFile(dir, "src/commands/doctor-state-integrity.cloud-storage.test.ts");
    writeRepoFile(dir, "src/commands/status.service-summary.test.ts");
    writeRepoFile(dir, "src/gateway/server.control-ui-root.test.ts");
    writeRepoFile(dir, "src/install-sh-version.test.ts");
    writeRepoFile(dir, "src/telegram/fetch.test.ts");
    writeRepoFile(dir, "src/web/media.test.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/acp/client.test.ts",
      "src/agents/model-fallback.test.ts",
      "src/agents/path-policy.test.ts",
      "src/agents/sandbox-paths.test.ts",
      "src/cli/program/register.agent.test.ts",
      "src/cli/gateway-cli.coverage.test.ts",
      "src/commands/doctor-state-integrity.cloud-storage.test.ts",
      "src/commands/status.service-summary.test.ts",
      "src/gateway/server.control-ui-root.test.ts",
      "src/install-sh-version.test.ts",
      "src/telegram/fetch.test.ts",
      "src/web/media.test.ts",
    ]);

    const brandingOutput = runAudit(dir, ["--group", "H1F", "--manifest"]);
    const supportOutput = runAudit(dir, ["--group", "H1G", "--manifest"]);
    const browserOutput = runAudit(dir, ["--group", "H1E", "--manifest"]);
    const cliOutput = runAudit(dir, ["--group", "H1B1", "--manifest"]);
    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);
    const controlUiOutput = runAudit(dir, ["--group", "B", "--manifest"]);
    const installerOutput = runAudit(dir, ["--group", "H1A1A", "--manifest"]);

    expect(brandingOutput).toContain("Group H1F Landing Manifest");
    expect(brandingOutput).toContain("src/agents/model-fallback.test.ts");
    expect(brandingOutput).toContain("src/agents/path-policy.test.ts");
    expect(brandingOutput).toContain("src/web/media.test.ts");
    expect(brandingOutput).not.toContain("src/acp/client.test.ts");
    expect(supportOutput).toContain("Group H1G Landing Manifest");
    expect(supportOutput).toContain("src/acp/client.test.ts");
    expect(supportOutput).toContain("src/telegram/fetch.test.ts");
    expect(supportOutput).not.toContain("src/agents/path-policy.test.ts");
    expect(browserOutput).toContain("Group H1E Landing Manifest");
    expect(browserOutput).toContain("src/agents/sandbox-paths.test.ts");
    expect(browserOutput).not.toContain("src/install-sh-version.test.ts");
    expect(cliOutput).toContain("Group H1B1 Landing Manifest");
    expect(cliOutput).toContain("src/cli/program/register.agent.test.ts");
    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/cli/gateway-cli.coverage.test.ts");
    expect(operatorOutput).toContain("src/commands/status.service-summary.test.ts");
    expect(controlUiOutput).toContain("Group B Landing Manifest");
    expect(controlUiOutput).toContain("src/gateway/server.control-ui-root.test.ts");
    expect(installerOutput).toContain("Group H1A1A Landing Manifest");
    expect(installerOutput).toContain("src/install-sh-version.test.ts");
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/commands/doctor-state-integrity.cloud-storage.test.ts");
  });

  it("keeps status, configure, and onboarding guidance inside H1D", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/commands/configure.wizard.ts");
    writeRepoFile(dir, "src/commands/doctor-config-flow.ts");
    writeRepoFile(dir, "src/commands/onboard-non-interactive.ts");
    writeRepoFile(dir, "src/commands/status.command.ts");
    writeRepoFile(dir, "src/commands/status-all.ts");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/commands/configure.wizard.ts",
      "src/commands/doctor-config-flow.ts",
      "src/commands/onboard-non-interactive.ts",
      "src/commands/status.command.ts",
      "src/commands/status-all.ts",
      "src/config/paths.ts",
    ]);

    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/commands/configure.wizard.ts");
    expect(operatorOutput).toContain("src/commands/doctor-config-flow.ts");
    expect(operatorOutput).toContain("src/commands/onboard-non-interactive.ts");
    expect(operatorOutput).toContain("src/commands/status.command.ts");
    expect(operatorOutput).toContain("src/commands/status-all.ts");
    expect(operatorOutput).not.toContain("src/config/paths.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("src/commands/status.command.ts");
  });

  it("keeps agent/session command surfaces and backup naming in their owning groups", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/cli/program/register.agent.ts");
    writeRepoFile(dir, "src/cli/tagline.ts");
    writeRepoFile(dir, "src/commands/onboard-search.ts");
    writeRepoFile(dir, "src/commands/backup-shared.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/cli/program/register.agent.ts",
      "src/cli/tagline.ts",
      "src/commands/onboard-search.ts",
      "src/commands/backup-shared.ts",
    ]);

    const cliOutput = runAudit(dir, ["--group", "H1B1", "--manifest"]);
    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    expect(cliOutput).toContain("Group H1B1 Landing Manifest");
    expect(cliOutput).toContain("src/cli/program/register.agent.ts");
    expect(cliOutput).toContain("src/cli/tagline.ts");
    expect(cliOutput).not.toContain("src/commands/onboard-search.ts");
    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/commands/onboard-search.ts");
    expect(operatorOutput).not.toContain("src/commands/backup-shared.ts");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/commands/backup-shared.ts");
    expect(stateOutput).not.toContain("src/cli/tagline.ts");
  });

  it("keeps current-only gateway, daemon, and operator tails inside existing groups", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "src/gateway/client.ts");
    writeRepoFile(dir, "src/gateway/server.impl.ts");
    writeRepoFile(dir, "src/daemon/runtime-hints.test.ts");
    writeRepoFile(dir, "src/commands/configure.wizard.test.ts");
    writeRepoFile(dir, "src/commands/status.scan.ts");
    writeRepoFile(dir, "src/commands/doctor.warns-state-directory-is-missing.e2e.test.ts");
    run(dir, "git", [
      "add",
      "--",
      "src/gateway/client.ts",
      "src/gateway/server.impl.ts",
      "src/daemon/runtime-hints.test.ts",
      "src/commands/configure.wizard.test.ts",
      "src/commands/status.scan.ts",
      "src/commands/doctor.warns-state-directory-is-missing.e2e.test.ts",
    ]);

    const controlUiOutput = runAudit(dir, ["--group", "B", "--manifest"]);
    const dgvOutput = runAudit(dir, ["--group", "DGV2", "--manifest"]);
    const daemonOutput = runAudit(dir, ["--group", "H1C", "--manifest"]);
    const operatorOutput = runAudit(dir, ["--group", "H1D", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    expect(controlUiOutput).toContain("Group B Landing Manifest");
    expect(controlUiOutput).toContain("src/gateway/client.ts");
    expect(controlUiOutput).not.toContain("src/gateway/server.impl.ts");
    expect(controlUiOutput).not.toContain("src/daemon/runtime-hints.test.ts");
    expect(dgvOutput).toContain("Group DGV2 Landing Manifest");
    expect(dgvOutput).toContain("src/gateway/server.impl.ts");
    expect(daemonOutput).toContain("Group H1C Landing Manifest");
    expect(daemonOutput).toContain("src/daemon/runtime-hints.test.ts");
    expect(daemonOutput).not.toContain("src/commands/configure.wizard.test.ts");
    expect(operatorOutput).toContain("Group H1D Landing Manifest");
    expect(operatorOutput).toContain("src/commands/configure.wizard.test.ts");
    expect(operatorOutput).toContain("src/commands/status.scan.ts");
    expect(operatorOutput).not.toContain(
      "src/commands/doctor.warns-state-directory-is-missing.e2e.test.ts",
    );
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain(
      "src/commands/doctor.warns-state-directory-is-missing.e2e.test.ts",
    );
    expect(stateOutput).not.toContain("src/gateway/client.ts");
  });

  it("keeps runtime docs and platform guides out of analysis docs", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/android/README.md");
    writeRepoFile(dir, "docs/gateway/protocol.md");
    writeRepoFile(dir, "docs/platforms/ios.md");
    writeRepoFile(dir, "docs/design/install-sh-landing-checklist-2026-04-10.md");
    writeRepoFile(dir, "docs/design/worktree-landing-groups-2026-04-09.md");
    run(dir, "git", [
      "add",
      "--",
      "apps/android/README.md",
      "docs/gateway/protocol.md",
      "docs/platforms/ios.md",
      "docs/design/install-sh-landing-checklist-2026-04-10.md",
      "docs/design/worktree-landing-groups-2026-04-09.md",
    ]);

    const runtimeDocsOutput = runAudit(dir, ["--group", "I", "--manifest"]);
    const analysisOutput = runAudit(dir, ["--group", "F", "--manifest"]);

    expect(runtimeDocsOutput).toContain("Group I Landing Manifest");
    expect(runtimeDocsOutput).toContain("apps/android/README.md");
    expect(runtimeDocsOutput).toContain("docs/gateway/protocol.md");
    expect(runtimeDocsOutput).toContain("docs/platforms/ios.md");
    expect(runtimeDocsOutput).not.toContain(
      "docs/design/install-sh-landing-checklist-2026-04-10.md",
    );
    expect(runtimeDocsOutput).not.toContain("docs/design/worktree-landing-groups-2026-04-09.md");
    expect(analysisOutput).toContain("Group F Landing Manifest");
    expect(analysisOutput).toContain("docs/design/install-sh-landing-checklist-2026-04-10.md");
    expect(analysisOutput).toContain("docs/design/worktree-landing-groups-2026-04-09.md");
    expect(analysisOutput).not.toContain("docs/platforms/ios.md");
  });

  it("keeps app canvas runtime wiring separate from generated bundle output", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/android/app/src/main/java/ai/openclaw/app/node/A2UIHandler.kt");
    writeRepoFile(dir, "apps/ios/Sources/Screen/ScreenWebView.swift");
    writeRepoFile(dir, "apps/macos/Sources/OpenBot/CanvasManager.swift");
    writeRepoFile(dir, "src/canvas-host/a2ui/a2ui.bundle.js");
    writeRepoFile(dir, "src/config/paths.ts");
    run(dir, "git", [
      "add",
      "--",
      "apps/android/app/src/main/java/ai/openclaw/app/node/A2UIHandler.kt",
      "apps/ios/Sources/Screen/ScreenWebView.swift",
      "apps/macos/Sources/OpenBot/CanvasManager.swift",
      "src/canvas-host/a2ui/a2ui.bundle.js",
      "src/config/paths.ts",
    ]);

    const appCanvasOutput = runAudit(dir, ["--group", "H5A", "--manifest"]);
    const hmacOutput = runAudit(dir, ["--group", "HMAC", "--manifest"]);
    const generatedOutput = runAudit(dir, ["--group", "G", "--manifest"]);
    const stateOutput = runAudit(dir, ["--group", "H2", "--manifest"]);

    expect(appCanvasOutput).toContain("Group H5A Landing Manifest");
    expect(appCanvasOutput).toContain(
      "apps/android/app/src/main/java/ai/openclaw/app/node/A2UIHandler.kt",
    );
    expect(appCanvasOutput).not.toContain("apps/macos/Sources/OpenBot/CanvasManager.swift");
    expect(appCanvasOutput).not.toContain("src/canvas-host/a2ui/a2ui.bundle.js");
    expect(hmacOutput).toContain("Group HMAC Landing Manifest");
    expect(hmacOutput).toContain("apps/macos/Sources/OpenBot/CanvasManager.swift");
    expect(generatedOutput).toContain("Group G Landing Manifest");
    expect(generatedOutput).toContain("src/canvas-host/a2ui/a2ui.bundle.js");
    expect(stateOutput).toContain("Group H2 Landing Manifest");
    expect(stateOutput).toContain("src/config/paths.ts");
    expect(stateOutput).not.toContain("apps/macos/Sources/OpenBot/CanvasManager.swift");
  });

  it("keeps canvas deep-link and identity wiring separate from A2UI compatibility", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/ios/Sources/Model/NodeAppModel.swift");
    writeRepoFile(dir, "apps/ios/Sources/Screen/ScreenWebView.swift");
    writeRepoFile(dir, "apps/macos/Sources/OpenBot/CanvasWindowController.swift");
    writeRepoFile(dir, "apps/android/app/src/main/java/ai/openclaw/app/node/A2UIHandler.kt");
    run(dir, "git", [
      "add",
      "--",
      "apps/ios/Sources/Model/NodeAppModel.swift",
      "apps/ios/Sources/Screen/ScreenWebView.swift",
      "apps/macos/Sources/OpenBot/CanvasWindowController.swift",
      "apps/android/app/src/main/java/ai/openclaw/app/node/A2UIHandler.kt",
    ]);

    const a2uiOutput = runAudit(dir, ["--group", "H5A", "--manifest"]);
    const identityOutput = runAudit(dir, ["--group", "H5B1B", "--manifest"]);
    const hmacOutput = runAudit(dir, ["--group", "HMAC", "--manifest"]);

    expect(a2uiOutput).toContain("Group H5A Landing Manifest");
    expect(a2uiOutput).toContain(
      "apps/android/app/src/main/java/ai/openclaw/app/node/A2UIHandler.kt",
    );
    expect(a2uiOutput).not.toContain("apps/ios/Sources/Model/NodeAppModel.swift");
    expect(identityOutput).toContain("Group H5B1B Landing Manifest");
    expect(identityOutput).toContain("apps/ios/Sources/Screen/ScreenWebView.swift");
    expect(identityOutput).not.toContain("apps/macos/Sources/OpenBot/CanvasWindowController.swift");
    expect(identityOutput).not.toContain(
      "apps/android/app/src/main/java/ai/openclaw/app/node/A2UIHandler.kt",
    );
    expect(hmacOutput).toContain("Group HMAC Landing Manifest");
    expect(hmacOutput).toContain("apps/macos/Sources/OpenBot/CanvasWindowController.swift");
  });

  it("keeps iOS node canvas identity separate from shell and bridge wiring", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/ios/Sources/Model/NodeAppModel.swift");
    writeRepoFile(dir, "apps/ios/Sources/Screen/ScreenWebView.swift");
    writeRepoFile(dir, "apps/macos/Sources/OpenBot/CanvasWindowController.swift");
    run(dir, "git", [
      "add",
      "--",
      "apps/ios/Sources/Model/NodeAppModel.swift",
      "apps/ios/Sources/Screen/ScreenWebView.swift",
      "apps/macos/Sources/OpenBot/CanvasWindowController.swift",
    ]);

    const shellBridgeOutput = runAudit(dir, ["--group", "H5B1B", "--manifest"]);
    const hmacOutput = runAudit(dir, ["--group", "HMAC", "--manifest"]);
    const iosNodeOutput = runAudit(dir, ["--group", "H5B2", "--manifest"]);

    expect(shellBridgeOutput).toContain("Group H5B1B Landing Manifest");
    expect(shellBridgeOutput).toContain("apps/ios/Sources/Screen/ScreenWebView.swift");
    expect(shellBridgeOutput).not.toContain(
      "apps/macos/Sources/OpenBot/CanvasWindowController.swift",
    );
    expect(shellBridgeOutput).not.toContain("apps/ios/Sources/Model/NodeAppModel.swift");
    expect(hmacOutput).toContain("Group HMAC Landing Manifest");
    expect(hmacOutput).toContain("apps/macos/Sources/OpenBot/CanvasWindowController.swift");
    expect(iosNodeOutput).toContain("Group H5B2 Landing Manifest");
    expect(iosNodeOutput).toContain("apps/ios/Sources/Model/NodeAppModel.swift");
    expect(iosNodeOutput).not.toContain("apps/ios/Sources/Screen/ScreenWebView.swift");
  });

  it("keeps canvas shell copy separate from deep-link bridge wiring", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/android/app/src/main/java/ai/openclaw/app/ui/PostOnboardingTabs.kt");
    writeRepoFile(dir, "apps/ios/Sources/Screen/ScreenWebView.swift");
    writeRepoFile(dir, "apps/macos/Sources/OpenBot/CanvasWindowController+Window.swift");
    writeRepoFile(dir, "apps/macos/Sources/OpenBot/CanvasWindowController.swift");
    run(dir, "git", [
      "add",
      "--",
      "apps/android/app/src/main/java/ai/openclaw/app/ui/PostOnboardingTabs.kt",
      "apps/ios/Sources/Screen/ScreenWebView.swift",
      "apps/macos/Sources/OpenBot/CanvasWindowController+Window.swift",
      "apps/macos/Sources/OpenBot/CanvasWindowController.swift",
    ]);

    const shellCopyOutput = runAudit(dir, ["--group", "H5B1A", "--manifest"]);
    const bridgeOutput = runAudit(dir, ["--group", "H5B1B", "--manifest"]);
    const hmacOutput = runAudit(dir, ["--group", "HMAC", "--manifest"]);

    expect(shellCopyOutput).toContain("Group H5B1A Landing Manifest");
    expect(shellCopyOutput).toContain(
      "apps/android/app/src/main/java/ai/openclaw/app/ui/PostOnboardingTabs.kt",
    );
    expect(shellCopyOutput).not.toContain(
      "apps/macos/Sources/OpenBot/CanvasWindowController+Window.swift",
    );
    expect(shellCopyOutput).not.toContain("apps/ios/Sources/Screen/ScreenWebView.swift");
    expect(bridgeOutput).toContain("Group H5B1B Landing Manifest");
    expect(bridgeOutput).toContain("apps/ios/Sources/Screen/ScreenWebView.swift");
    expect(bridgeOutput).not.toContain("apps/macos/Sources/OpenBot/CanvasWindowController.swift");
    expect(bridgeOutput).not.toContain(
      "apps/android/app/src/main/java/ai/openclaw/app/ui/PostOnboardingTabs.kt",
    );
    expect(hmacOutput).toContain("Group HMAC Landing Manifest");
    expect(hmacOutput).toContain("apps/macos/Sources/OpenBot/CanvasWindowController+Window.swift");
    expect(hmacOutput).toContain("apps/macos/Sources/OpenBot/CanvasWindowController.swift");
  });

  it("keeps app shell and onboarding copy separate from canvas runtime", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/android/app/src/main/java/ai/openclaw/app/NodeForegroundService.kt");
    writeRepoFile(dir, "apps/android/app/src/main/res/values/strings.xml");
    writeRepoFile(dir, "apps/ios/Sources/Onboarding/OnboardingWizardView.swift");
    writeRepoFile(dir, "apps/macos/Sources/OpenBot/MenuContentView.swift");
    writeRepoFile(dir, "apps/android/app/src/main/java/ai/openclaw/app/node/A2UIHandler.kt");
    run(dir, "git", [
      "add",
      "--",
      "apps/android/app/src/main/java/ai/openclaw/app/NodeForegroundService.kt",
      "apps/android/app/src/main/res/values/strings.xml",
      "apps/ios/Sources/Onboarding/OnboardingWizardView.swift",
      "apps/macos/Sources/OpenBot/MenuContentView.swift",
      "apps/android/app/src/main/java/ai/openclaw/app/node/A2UIHandler.kt",
    ]);

    const shellOutput = runAudit(dir, ["--group", "H6", "--manifest"]);
    const hmacOutput = runAudit(dir, ["--group", "HMAC", "--manifest"]);
    const canvasOutput = runAudit(dir, ["--group", "H5A", "--manifest"]);

    expect(shellOutput).toContain("Group H6 Landing Manifest");
    expect(shellOutput).toContain(
      "apps/android/app/src/main/java/ai/openclaw/app/NodeForegroundService.kt",
    );
    expect(shellOutput).toContain("apps/android/app/src/main/res/values/strings.xml");
    expect(shellOutput).toContain("apps/ios/Sources/Onboarding/OnboardingWizardView.swift");
    expect(shellOutput).not.toContain("apps/macos/Sources/OpenBot/MenuContentView.swift");
    expect(shellOutput).not.toContain(
      "apps/android/app/src/main/java/ai/openclaw/app/node/A2UIHandler.kt",
    );
    expect(hmacOutput).toContain("Group HMAC Landing Manifest");
    expect(hmacOutput).toContain("apps/macos/Sources/OpenBot/MenuContentView.swift");
    expect(canvasOutput).toContain("Group H5A Landing Manifest");
    expect(canvasOutput).toContain(
      "apps/android/app/src/main/java/ai/openclaw/app/node/A2UIHandler.kt",
    );
    expect(canvasOutput).not.toContain("apps/macos/Sources/OpenBot/MenuContentView.swift");
  });

  it("prints only matching paths in paths-only mode", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, ".gitignore");
    writeRepoFile(dir, "src/infra/git-commit.ts");
    writeRepoFile(dir, "ui/index.html");
    run(dir, "git", ["add", "--", ".gitignore", "src/infra/git-commit.ts", "ui/index.html"]);

    const output = runAudit(dir, ["--group", "D", "--paths-only"]);

    expect(output.split("\n")).toEqual([".gitignore", "src/infra/git-commit.ts"]);
  });

  it("prints a landing manifest grouped by status kind", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, ".gitignore");
    run(dir, "git", ["add", "--", ".gitignore"]);
    run(dir, "git", ["commit", "-m", "seed"], {
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    });

    writeRepoFile(dir, ".gitignore", "node_modules\n");
    writeRepoFile(dir, "scripts/worktree-audit.ts", "console.log('audit');\n");
    run(dir, "git", ["add", "--", "scripts/worktree-audit.ts"]);

    const dOutput = runAudit(dir, ["--group", "D", "--manifest"]);
    const ewgOutput = runAudit(dir, ["--group", "EWG", "--manifest"]);

    expect(dOutput).toContain("Group D Landing Manifest");
    expect(dOutput).toContain("- modified: 1");
    expect(dOutput).toContain("  - .gitignore");
    expect(dOutput).not.toContain("scripts/worktree-audit.ts");
    expect(ewgOutput).toContain("Group EWG Landing Manifest");
    expect(ewgOutput).toContain("- added: 1");
    expect(ewgOutput).toContain("  - scripts/worktree-audit.ts");
  });

  it("prints a dry-run staging plan for the selected group", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, ".gitignore");
    run(dir, "git", ["add", "--", ".gitignore"]);
    run(dir, "git", ["commit", "-m", "seed"], {
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    });

    writeRepoFile(dir, ".gitignore", "node_modules\n");
    writeRepoFile(dir, "scripts/worktree-audit.ts", "console.log('audit');\n");
    run(dir, "git", ["add", "--", "scripts/worktree-audit.ts"]);

    const dOutput = runAudit(dir, ["--group", "D", "--stage-plan"]);
    const ewgOutput = runAudit(dir, ["--group", "EWG", "--stage-plan"]);

    expect(dOutput).toContain("# Stage plan for group D");
    expect(dOutput).toContain("# Dry-run only. Review before executing.");
    expect(dOutput).toContain("git add -- '.gitignore'");
    expect(dOutput).not.toContain("scripts/worktree-audit.ts");
    expect(ewgOutput).toContain("# Stage plan for group EWG");
    expect(ewgOutput).toContain("git add -- 'scripts/worktree-audit.ts'");
  });

  it("filters overlap-only paths against a historical commit", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "ui/index.html");
    writeRepoFile(dir, "src/config/paths.ts");
    writeRepoFile(dir, "packages/collaboration-core/package.json", "{}\n");
    run(dir, "git", [
      "add",
      "--",
      "ui/index.html",
      "src/config/paths.ts",
      "packages/collaboration-core/package.json",
    ]);
    run(dir, "git", ["commit", "-m", "seed"], {
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    });

    writeRepoFile(dir, "ui/index.html", "legacy\n");
    writeRepoFile(dir, "src/config/paths.ts", "legacy\n");
    run(dir, "git", ["add", "--", "ui/index.html", "src/config/paths.ts"]);
    run(dir, "git", ["commit", "-m", "legacy"], {
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    });

    writeRepoFile(dir, "ui/index.html", "current-overlap\n");
    writeRepoFile(dir, "packages/collaboration-core/package.json", '{"name":"pkg"}\n');

    const overlapOutput = runAudit(dir, [
      "--overlap-with",
      "HEAD",
      "--overlap-only",
      "--paths-only",
    ]);
    const currentOnlyOutput = runAudit(dir, [
      "--overlap-with",
      "HEAD",
      "--current-only",
      "--paths-only",
    ]);

    expect(overlapOutput.split("\n")).toEqual(["ui/index.html"]);
    expect(currentOnlyOutput.split("\n")).toEqual(["packages/collaboration-core/package.json"]);
  });

  it("reports overlap metadata in normal audit output", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "ui/index.html");
    run(dir, "git", ["add", "--", "ui/index.html"]);
    run(dir, "git", ["commit", "-m", "seed"], {
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    });

    writeRepoFile(dir, "ui/index.html", "legacy\n");
    run(dir, "git", ["add", "--", "ui/index.html"]);
    run(dir, "git", ["commit", "-m", "legacy"], {
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    });

    writeRepoFile(dir, "ui/index.html", "current-overlap\n");

    const output = runAudit(dir, ["--group", "A", "--overlap-with", "HEAD", "--overlap-only"]);

    expect(output).toContain("selected group: A");
    expect(output).toContain("overlap with: HEAD");
    expect(output).toContain("overlap mode: overlap-only");
    expect(output).toContain("overlap entries: 1");
    expect(output).toContain("MERGE A: Workbench And Employee UI Recovery");
  });

  it("blocks cached mixed primary groups", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "ui/index.html");
    writeRepoFile(dir, "src/cli/cli-name.ts");
    run(dir, "git", ["add", "--", "ui/index.html", "src/cli/cli-name.ts"]);

    // Two non-parallel primaries (A + H1B1). D/parallel may accompany one primary, so
    // ui/index.html + packages/**/package.json is no longer a risky mix.
    expect(() => runAudit(dir, ["--cached", "--fail-on-risky-mix"])).toThrowError(
      /Staged changes span multiple landing (groups|streams)/,
    );
  });

  it("allows cached guardrails plus one primary group", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, ".gitignore");
    writeRepoFile(dir, "ui/index.html");
    run(dir, "git", ["add", "--", ".gitignore", "ui/index.html"]);

    const output = runAudit(dir, ["--cached", "--fail-on-risky-mix"]);

    expect(output).toContain("Worktree Audit (cached)");
    expect(output).toContain("MERGE D: Pure Guardrails");
    expect(output).toContain("MERGE A: Workbench And Employee UI Recovery");
  });

  it("allows cached linked ios identity groups that must land together", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/ios/Config/Signing.xcconfig");
    writeRepoFile(dir, "apps/ios/Signing.xcconfig");
    writeRepoFile(dir, "scripts/ios-beta-prepare.sh");
    run(dir, "git", [
      "add",
      "--",
      "apps/ios/Config/Signing.xcconfig",
      "apps/ios/Signing.xcconfig",
      "scripts/ios-beta-prepare.sh",
    ]);

    const output = runAudit(dir, ["--cached", "--fail-on-risky-mix"]);

    expect(output).toContain("Worktree Audit (cached)");
    expect(output).toContain("ISOLATE H1I1B1A1A: OpenBot iOS Config Xcconfig Identity Surface");
    expect(output).toContain(
      "ISOLATE H1I1B1A1B: OpenBot iOS Manual Signing Xcconfig Identity Surface",
    );
    expect(output).toContain("ISOLATE H1I1B1B1: OpenBot iOS Beta Prepare Identity Surface");
  });

  it("allows cached linked canvas A2UI compatibility and generated bundle groups", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-worktree-audit-"));
    initRepo(dir);

    writeRepoFile(dir, "apps/android/app/src/main/java/ai/openclaw/app/node/A2UIHandler.kt");
    writeRepoFile(dir, "src/canvas-host/server.ts");
    writeRepoFile(dir, "src/canvas-host/a2ui/a2ui.bundle.js");
    writeRepoFile(dir, "src/canvas-host/a2ui/.bundle.hash");
    run(dir, "git", [
      "add",
      "--",
      "apps/android/app/src/main/java/ai/openclaw/app/node/A2UIHandler.kt",
      "src/canvas-host/server.ts",
      "src/canvas-host/a2ui/a2ui.bundle.js",
      "src/canvas-host/a2ui/.bundle.hash",
    ]);

    const output = runAudit(dir, ["--cached", "--fail-on-risky-mix"]);

    expect(output).toContain("Worktree Audit (cached)");
    expect(output).toContain("ISOLATE H5A: OpenBot App Canvas A2UI Compatibility Surface");
    expect(output).toContain("CLEAN G: Generated Or Review-Only Artifacts");
  });
});
