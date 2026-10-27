import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { decideDelivery, type GitRunner } from "./delivery/forward-guard.js";
import {
  classifyWithRegistry as loomClassify,
  findRiskyMix as loomFindRiskyMix,
} from "./loom/audit.js";
import { globToRegExp } from "./loom/glob.js";
import { type LandingPolicy, loadRegistry, type Registry, registryPath } from "./loom/registry.js";

type StatusEntry = {
  xy: string;
  path: string;
  originalPath?: string;
};

type AuditRule = {
  id: string;
  disposition: "MERGE" | "ISOLATE" | "CLEAN";
  group: string;
  title: string;
  matches: (path: string) => boolean;
};

type ClassifiedEntry = StatusEntry & {
  rule: AuditRule | null;
};

export type CommitDeliveryGuardResult = {
  status: "allow" | "warn" | "block" | "skipped";
  exitCode: 0 | 1;
  message: string | null;
};

export function evaluateCommitDeliveryGuard(input: {
  liveSha: string | null;
  candidate: string;
  git: GitRunner;
  strict?: boolean;
  verbose?: boolean;
}): CommitDeliveryGuardResult {
  if (!input.liveSha) {
    return {
      status: "skipped",
      exitCode: 0,
      message: input.verbose
        ? "Delivery guard: LIVE is unavailable; local commit check skipped."
        : null,
    };
  }

  const decision = decideDelivery({
    live: input.liveSha,
    candidate: input.candidate,
    protectedGlobs: ["src/**", "ui/src/**", "dist/**"],
    git: input.git,
  });
  if (decision.verdict === "allow") {
    return { status: "allow", exitCode: 0, message: null };
  }

  const prefix = input.strict ? "BLOCK" : "WARNING";
  return {
    status: input.strict ? "block" : "warn",
    exitCode: input.strict ? 1 : 0,
    message: `${prefix}: HEAD does not contain production LIVE ${input.liveSha}. Merge or rebase production before committing to avoid delivering older files.`,
  };
}

const rawArgs = process.argv.slice(2);

function readFlag(flag: string) {
  return rawArgs.includes(flag);
}

function readOption(name: string) {
  const index = rawArgs.indexOf(name);
  if (index < 0) {
    return null;
  }
  return rawArgs[index + 1] ?? null;
}

const cached = readFlag("--cached");
const verbose = readFlag("--verbose");
const json = readFlag("--json");
const pathsOnly = readFlag("--paths-only");
const manifest = readFlag("--manifest");
const stagePlan = readFlag("--stage-plan");
const failOnUnmatched = readFlag("--fail-on-unmatched");
const failOnRiskyMix = readFlag("--fail-on-risky-mix");
const selectedGroup = readOption("--group")?.trim().toUpperCase() ?? null;
const overlapWith = readOption("--overlap-with")?.trim() ?? null;
const overlapOnly = readFlag("--overlap-only");
const currentOnly = readFlag("--current-only");

/**
 * A path predicate that also carries the literal `exact`/`prefix` patterns it
 * was built from, so Loom's importer can reconstruct globs from the rule table.
 * Behavior of the predicate itself is unchanged.
 */
type PatternMatcher = ((candidate: string) => boolean) & {
  __exact?: string[];
  __prefix?: string[];
};

function exact(...paths: string[]): PatternMatcher {
  const set = new Set(paths);
  const fn: PatternMatcher = (candidate: string) => set.has(candidate);
  fn.__exact = paths;
  return fn;
}

function prefix(...prefixes: string[]): PatternMatcher {
  const fn: PatternMatcher = (candidate: string) =>
    prefixes.some((entry) => candidate.startsWith(entry));
  fn.__prefix = prefixes;
  return fn;
}

function oneOf(...predicates: PatternMatcher[]): PatternMatcher {
  const fn: PatternMatcher = (candidate: string) =>
    predicates.some((predicate) => predicate(candidate));
  fn.__exact = predicates.flatMap((predicate) => predicate.__exact ?? []);
  fn.__prefix = predicates.flatMap((predicate) => predicate.__prefix ?? []);
  return fn;
}

const legacyProductDisplayName = ["Open", "Claw"].join("");
const legacyMacAppSourceRoot = `apps/macos/Sources/${legacyProductDisplayName}`;
const legacyAnalysisDocNames = [
  "Dialogue-Prompt-Mechanism-Analysis.md",
  "Skills-Tools-Migration-Report.md",
].map((name) => `${legacyProductDisplayName}-${name}`);

/**
 * Legacy landing rules — INERT whenever `.loom/registry.yaml` exists.
 *
 * Rule selection is `activeRegistry ? buildRulesFromRegistry(...) : LEGACY_RULES`
 * (see below), and the registry is committed, so editing this table has no effect
 * on a normal checkout. To make paths landable, add or extend a `landingStreams`
 * entry in `.loom/registry.yaml` instead; see `.loom/README.md`.
 *
 * Kept only as a fallback for contexts with no registry (bare test fixtures) and
 * as the `loom check` parity baseline. Removed by loom spec task 6.3.
 */
const LEGACY_RULES: AuditRule[] = [
  {
    id: "clean-generated",
    disposition: "CLEAN",
    group: "G",
    title: "Generated Or Review-Only Artifacts",
    matches: oneOf(
      exact("src/canvas-host/a2ui/.bundle.hash", "src/canvas-host/a2ui/a2ui.bundle.js"),
      prefix(
        "apps/macos/.build/",
        "ui/node_modules/.vite/vitest/",
        "ui/src/ui/__screenshots__/",
        "ui/src/ui/controllers/__screenshots__/",
        "ui/src/ui/views/__screenshots__/",
      ),
    ),
  },
  {
    // Employee workbench click guides: docs + robot skills land as one stream.
    id: "merge-employee-workbench-guides",
    disposition: "MERGE",
    group: "EWG",
    title: "Employee Workbench Operation Guides",
    matches: oneOf(
      prefix(
        "docs/help/workbench/",
        "skills/user-guidance-protocol/",
        "skills/openbot-docs/",
        "skills/openbot-platform-ops/",
      ),
      exact(
        "docs/docs.json",
        "docs/help/index.md",
        "src/agents/builtin-steward/required-skills.ts",
        "src/agents/builtin-steward/required-skills.test.ts",
        "src/agents/builtin-steward/steward-skills-sync.test.ts",
        "src/gateway/capability-packs/starter-packs.ts",
        "src/gateway/capability-packs/starter-packs.test.ts",
        "scripts/worktree-audit.ts",
      ),
    ),
  },
  {
    // Keep early so skill_asset_save + platform-ops incubation docs land as one stream
    // instead of mixing OPERATOR_EMAIL_DESKTOP / ACCOUNT_SANDBOX_SKILLS_MOUNT / MRR.
    id: "merge-skill-asset-save-agent-tool",
    disposition: "MERGE",
    group: "SAS",
    title: "Agent skill_asset_save → 我的资产",
    matches: oneOf(
      prefix(
        "skills/openbot-platform-ops/",
        "src/agents/tools/skill-asset-save-tool",
        "src/agents/builtin-steward/",
      ),
      exact(
        "CHANGELOG.md",
        "scripts/worktree-audit.ts",
        "src/agents/openclaw-tools.ts",
        "src/agents/tool-catalog.ts",
        "src/agents/sandbox/constants.ts",
      ),
    ),
  },
  {
    // Keep this rule early so first-match wins over SKL/C/AGT/AGS/ASI/USRM/WPL for
    // the steward user-guidance-protocol feature landing as one primary stream.
    id: "merge-steward-user-guidance",
    disposition: "MERGE",
    group: "SUG",
    title: "Steward User Guidance Protocol Skill",
    matches: oneOf(
      prefix(
        "skills/user-guidance-protocol/",
        "src/agents/builtin-steward/",
        "src/gateway/agent-growth/guidance-event",
        "src/agents/tools/guidance-event-tool",
      ),
      exact(
        "CHANGELOG.md",
        "scripts/worktree-audit.ts",
        "src/agents/agent-scope.ts",
        "src/agents/agent-scope.test.ts",
        "src/agents/openclaw-tools.ts",
        "src/auto-reply/reply/get-reply.ts",
        "src/gateway/method-scopes.ts",
        "src/gateway/server-methods-list.ts",
        "src/gateway/server-methods/asset-incubation-session.ts",
        "src/gateway/server-methods/asset-incubation-session.test.ts",
        "src/infra/redact-secret-text.ts",
      ),
    ),
  },
  {
    id: "merge-asset-incubation",
    disposition: "MERGE",
    group: "ASI",
    title: "Asset Incubation Domain (Phases 0-4)",
    matches: oneOf(
      prefix(
        "src/gateway/asset-incubation-",
        "src/gateway/server-methods/asset-incubation-",
        "ui/src/ui/controllers/asset-incubation/",
      ),
      exact(
        "src/gateway/server-methods/platform-capability-incubation.test.ts",
        "src/gateway/server-methods/employee-capability.ts",
        "src/gateway/server-methods/platform-capability.ts",
        "src/gateway/method-scopes.ts",
        "src/gateway/server-methods-list.ts",
        "src/gateway/server-methods.ts",
        "ui/src/ui/controllers/asset-suggestion-trigger.ts",
        "ui/src/ui/app.ts",
        "ui/src/ui/app-gateway.ts",
        "ui/src/ui/app-gateway.node.test.ts",
        "ui/src/ui/chat/copy-as-markdown.ts",
        "ui/src/ui/chat/deliverable-envelope.ts",
        "ui/src/ui/chat/deliverable-envelope.test.ts",
        "ui/src/ui/chat/generated-preview-artifact.ts",
        "ui/src/ui/controllers/chat.test.ts",
        "ui/src/styles/chat/sidebar.css",
        "ui/src/ui/ports/employee/render-model.ts",
        "ui/src/ui/ports/employee/views/workbench-stage.ts",
        "ui/src/ui/ports/employee/views/workbench-stage.node.test.ts",
        "ui/src/ui/ports/employee/views/workbench-types.ts",
        "ui/src/ui/views/artifact-sidebar.ts",
        "ui/src/ui/views/my-accumulation.ts",
        "ui/src/ui/views/save-skill-modal.ts",
        "ui/src/ui/views/save-skill-modal.test.ts",
        ".loom/registry.yaml",
      ),
    ),
  },
  {
    id: "merge-ops-decommission",
    disposition: "MERGE",
    group: "OPSD",
    title: "Ops Port Decommission And Platform Absorption",
    matches: oneOf(
      prefix(".kiro/specs/ops-decommission/"),
      prefix("ui/src/ui/ports/ops/"),
      exact(
        "ui/src/ui/views/console-subnav.ts",
        "ui/src/ui/views/control-center.ts",
        "ui/src/ui/navigation.ts",
        "ui/src/ui/navigation.test.ts",
        "ui/src/ui/navigation.browser.test.ts",
        "ui/src/ui/app-gateway.ts",
        "ui/src/ui/app-lifecycle.ts",
        "ui/src/ui/app-polling.ts",
        "ui/src/ui/app-port-state.ts",
        "ui/src/ui/app-render.ts",
        "ui/src/ui/app-render.helpers.ts",
        "ui/src/ui/app-render.boundary.node.test.ts",
        "ui/src/ui/app-settings.ts",
        "ui/src/ui/app-settings.test.ts",
        "ui/src/ui/ports/platform/advanced/page.ts",
        "ui/src/ui/ports/platform/advanced/page.browser.test.ts",
        "ui/src/ui/ports/platform/render-actions.ts",
        "ui/src/ui/ports/platform/render-model.ts",
        "ui/src/ui/ports/platform/action-state.ts",
        "ui/src/ui/ports/platform/port-state.ts",
        "ui/src/ui/ports/platform/shared/surface.ts",
        "ui/src/ui/ports/platform/view-models/builders.ts",
        "ui/src/ui/ports/platform/view-types.ts",
        "ui/src/ui/ports/platform/views/platform-shell.ts",
        "ui/src/ui/ports/port-shells.browser.test.ts",
        "ui/src/ui/ports/port-state-lens.node.test.ts",
        "ui/src/ui/views/debug.ts",
        "ui/src/ui/views/debug.browser.test.ts",
        "ui/src/ui/views/enterprise-asset-library/enterprise-capability-center-page.ts",
        "ui/src/ui/views/enterprise-data-capability/landscape.browser.test.ts",
        "ui/src/styles/enterprise-data-capability.css",
      ),
      prefix(
        "ui/src/ui/ports/employee/render-model",
        "ui/src/ui/ports/employee/views/employee-sessions-preservation",
        "ui/src/ui/ports/employee/views/workbench",
        "ui/src/ui/ports/enterprise/",
        "src/gateway/enterprise-org-",
        "src/gateway/enterprise-handover-",
        "src/gateway/employee-workbench-scope",
      ),
      exact(
        "src/gateway/employee-steward-session.ts",
        "scripts/sync-enterprise-ownership-and-runtime.ts",
        "scripts/check-isolation-fail-closed.mjs",
      ),
    ),
  },
  {
    id: "merge-model-entitlement-chain",
    disposition: "MERGE",
    group: "ME",
    title: "Model Entitlement Chain (P1-P5 + gateway connect compat)",
    matches: oneOf(
      prefix(
        "src/gateway/model-entitlement/",
        "src/gateway/economics/",
        "src/gateway/resource-catalog/",
        "ui/src/ui/capability/model-authorization/",
        "ui/src/ui/capability/platform-model-binding/",
        "ui/src/ui/capability/platform-plan-bundle/",
        "ui/src/ui/capability/platform-subscriptions/",
        "ui/src/ui/capability/cost-economics/",
        "ui/src/ui/capability/resource-catalog/",
        "ui/src/ui/capability/cost-budget-billing/endpoints.ts",
        ".kiro/specs/model-entitlement-chain/",
        "src/gateway/enterprise-model/",
        ".kiro/specs/enterprise-ai-model-governance/",
      ),
      exact(
        // backend new files
        "src/gateway/server-methods/employee-model-access.ts",
        "src/gateway/server-methods/enterprise-model-provider.ts",
        "src/gateway/server-methods/enterprise-model-provider.test.ts",
        "src/gateway/server-methods/enterprise-model-catalog.ts",
        "src/gateway/server-methods/enterprise-model-catalog.test.ts",
        "src/gateway/server-methods/employee-model-access.test.ts",
        "src/gateway/server-methods/model-entitlement-management.ts",
        "src/gateway/server-methods/model-entitlement-management.test.ts",
        "src/gateway/platform-auth/session-domain.ts",
        "src/agents/model-credential-source.ts",
        "src/agents/model-auth.credential-source.property.test.ts",
        "src/agents/model-auth.credential-catalog.test.ts",
        "src/agents/model-fallback.entitlement.test.ts",
        "src/agents/model-fallback.aor-order.test.ts",
        "src/auto-reply/reply/agent-runner-execution.entitlement.test.ts",
        // backend edits (entitlement runtime gate + AOR + credential + scope)
        "src/agents/model-fallback.ts",
        "src/auto-reply/reply/agent-runner-execution.ts",
        "src/auto-reply/reply/followup-runner.ts",
        "src/auto-reply/reply/get-reply-run.ts",
        "src/auto-reply/reply/queue/types.ts",
        "src/cron/isolated-agent/run.ts",
        "src/gateway/billing/subscriptions-store.ts",
        "src/gateway/server-methods.ts",
        // P6.1: plan⇄model unified bundle surface + plan-lifecycle binding wiring
        "src/gateway/server-methods/platform-plan-bundle.ts",
        "src/gateway/server-methods/platform-plan-bundle.test.ts",
        "src/gateway/server-methods/platform-economics.ts",
        "src/gateway/server-methods/resource-catalog.ts",
        "src/gateway/package-entitlement/normalize-entitlement.test.ts",
        "scripts/audit-plan-model-bindings.ts",
        "src/config/types.gateway.ts",
        "src/config/zod-schema.ts",
        "src/config/schema.help.ts",
        "src/config/schema.labels.ts",
        "src/gateway/protocol/schema/primitives.ts",
        // UI: model authorization surfaces + mounts
        "ui/src/ui/views/model-authorization-panel.ts",
        "ui/src/ui/views/model-authorization-panel.browser.test.ts",
        "ui/src/ui/views/model-authorization-section.ts",
        "ui/src/ui/views/model-authorization-section.browser.test.ts",
        "ui/src/ui/views/employee-model-access.ts",
        "ui/src/ui/views/employee-model-access.browser.test.ts",
        "ui/src/ui/views/employee-model-access-section.ts",
        "ui/src/ui/views/employee-model-access-section.browser.test.ts",
        "ui/src/ui/app-render.ts",
        "ui/src/ui/ports/employee/views/workbench-stage-module.ts",
        "ui/src/ui/ports/enterprise/views/enterprise-access-control-surface.ts",
        // UI: platform unified plan<->model binding surface (P6)
        "ui/src/ui/views/platform-plan-model-binding-section.ts",
        "ui/src/ui/views/platform-plan-model-binding-section.browser.test.ts",
        "ui/src/ui/ports/platform/pricing/page.ts",
        "docs/design/platform-pricing-model-binding-unification-plan-2026-06-09.md",
        "docs/design/platform-pricing-operating-dashboard-acceptance-report-2026-06-13.md",
        "docs/design/platform-pricing-tiers-2026-06-16.md",
        "docs/design/platform-dead-code-consolidated-2026-06-15.md",
        "docs/design/platform-ui-spec.md",
        "scripts/seed-platform-plan-templates.ts",
        "src/gateway/server-methods/platform-allocation.ts",
        "src/gateway/server-methods/enterprise-allocation.ts",
        "src/gateway/server-methods/platform-subscriptions.ts",
        // AGENTS.md troubleshooting notes added during this work stream
        "AGENTS.md",
      ),
    ),
  },
  {
    id: "isolate-aor-runtime",
    disposition: "ISOLATE",
    group: "AOR",
    title: "AOR Agent Orchestration Runtime",
    matches: oneOf(
      exact(
        "scripts/check-aor-boundaries.ts",
        "package.json",
        "tsconfig.json",
        "ui/src/styles.css",
        "ui/src/styles/cost-budget.css",
        "ui/src/ui/views/cost-budget/cost-budget-page.ts",
        "ui/src/ui/views/cost-budget/cost-budget-page.browser.test.ts",
      ),
      prefix(
        "packages/aor-core/",
        "packages/aor-backend-openbot/",
        "packages/aor-backend-stub/",
        "packages/aor-backend-graph/",
        "packages/aor-sdk-node/",
        "packages/aor-sdk-python/",
        "docs/design/aor-",
      ),
    ),
  },
  {
    id: "merge-platform-models-management",
    disposition: "MERGE",
    group: "PM",
    title: "Platform Models Management And AOR Two-Mode Integration",
    matches: oneOf(
      prefix("src/gateway/models/platform-models"),
      prefix("ui/src/ui/ports/platform/models/"),
      exact(
        "src/gateway/server-methods/models-management.ts",
        "src/gateway/protocol/schema/models-management.ts",
        "src/gateway/server-methods.ts",
        "src/gateway/server-methods-list.ts",
        "src/gateway/method-scopes.ts",
        "src/gateway/control-ui.ts",
        "src/gateway/control-ui-contract.ts",
        "src/config/types.gateway.ts",
        "src/gateway/protocol/index.ts",
        "src/gateway/protocol/schema.ts",
        "src/gateway/protocol/schema/protocol-schemas.ts",
        "src/gateway/protocol/schema/types.ts",
        "ui/src/ui/controllers/platform-models-management.ts",
        "ui/src/ui/app-settings.ts",
        "ui/src/ui/controllers/control-ui-bootstrap.ts",
        "ui/src/ui/ports/platform/port-state.ts",
        "ui/src/ui/ports/platform/action-state.ts",
        "ui/src/ui/ports/platform/render-actions.ts",
        "ui/src/ui/app.ts",
        "ui/src/ui/app-view-state-shell-slices.ts",
        "ui/src/ui/ports/platform/system-settings/page.ts",
        "ui/src/ui/ports/platform/semantic/platform-read-model.ts",
        "docs/design/model-management-aor-two-mode-integration-checklist-2026-06-05.md",
      ),
    ),
  },
  {
    id: "merge-pure-guardrails",
    disposition: "MERGE",
    group: "D",
    title: "Pure Guardrails",
    matches: oneOf(
      exact(
        ".gitignore",
        ".oxlintrc.json",
        "pnpm-lock.yaml",
        "git-hooks/pre-commit",
        "scripts/pre-commit/filter-staged-files.mjs",
        "scripts/pre-commit/run-node-tool.sh",
        ".github/actions/detect-docs-changes/action.yml",
        "scripts/check-no-raw-channel-fetch.mjs",
        "scripts/check-openbot-ui-boundaries.mjs",
        "scripts/check-tenant-addressing.mjs",
        "scripts/worktree-audit.ts",
        "scripts/agent-attribution.ts",
        "scripts/loom.ts",
        "src/channels/plugins/types.plugin.ts",
        "src/infra/git-commit.ts",
        "src/shared/config-ui-hints-types.ts",
        "test/git-hooks-pre-commit.test.ts",
        "test/worktree-audit.test.ts",
        "scripts/ci-changed-scope.mjs",
        "src/scripts/ci-changed-scope.test.ts",
        "scripts/ci-local-merge-gate.sh",
        "scripts/protocol-gen-swift.ts",
        "scripts/employee-capability-terminology-lint.ts",
        "docs/reference/ci-local-merge-gate.md",
        ".github/workflows/ci-gate.yml",
        ".github/workflows/ci-canary.yml",
        ".github/workflows/ci.yml",
        "src/hooks/install.test.ts",
      ),
      // git-hooks/ 整目录归 D：新增 hook（commit-msg / pre-push）与 pre-commit
      // 同属仓库级护栏，逐个 exact 列举会让每加一个 hook 就被判 UNMATCHED 卡住。
      prefix(
        ".loom/",
        "scripts/loom/",
        "scripts/__tests__/loom/",
        "scripts/e2e/",
        "packages/",
        "git-hooks/",
      ),
    ),
  },
  {
    id: "merge-data-governance-v2-p0",
    disposition: "MERGE",
    group: "DGV2",
    title: "Data Governance v2 Gate0 And P0 Workspace Isolation",
    // Keep ahead of EDGSC/B/MRR so governance handler slices land as one primary stream.
    matches: oneOf(
      prefix(
        ".kiro/specs/data-governance-v2-p0/",
        "src/gateway/data-governance/",
        "src/gateway/security-profile/",
        "src/gateway/workspace-inventory/",
        "src/gateway/workspace-ownership/",
        "src/gateway/workspace-resolver/",
        "src/gateway/workspace-cutover/",
      ),
      exact(
        "SECURITY.md",
        "deploy/production/env.production.example",
        "deploy/production/scripts/gate-seat-registry.sh",
        "scripts/audit/workspace-inventory.ts",
        "scripts/audit/governed-workspace-identity-repair.ts",
        "src/gateway/server.impl.ts",
        "src/gateway/server-methods/steward-workspace-file.ts",
        "src/gateway/server-methods/steward-workspace-file.test.ts",
        "src/gateway/server-methods/steward-workspace-file.p0e.test.ts",
        "src/gateway/server-methods/group-workspace-file.ts",
        "src/gateway/server-methods/group-workspace-file.pack.ts",
        "src/gateway/server-methods/group-workspace-file.test.ts",
        "src/gateway/server-methods/packs/manifest.ts",
        "src/gateway/knowledge/deliverables/save-and-archive.ts",
        "src/gateway/knowledge/deliverables/maybe-auto-capture-agent-deliverable.ts",
        "src/gateway/knowledge/knowledge-document-preview.ts",
        "src/gateway/knowledge/knowledge-document-preview.test.ts",
        "src/gateway/knowledge/knowledge-original-store.ts",
        "src/gateway/knowledge/knowledge-original-store.test.ts",
        "src/gateway/server-methods/knowledge.ts",
        "src/gateway/server-methods/knowledge-document-preview-rpc.test.ts",
        "src/gateway/protocol/schema/knowledge.ts",
        "docs/design/openbot-data-governance-architecture-v2-2026-08-10.md",
        "docs/design/workspace-directory-isolation-audit-2026-08-10.md",
      ),
    ),
  },
  {
    id: "isolate-openbot-readme-surface",
    disposition: "ISOLATE",
    group: "H1A0A1",
    title: "OpenBot README Install And Naming Surface",
    matches: oneOf(exact("README.md")),
  },
  {
    id: "isolate-openbot-release-check-metadata-surface",
    disposition: "ISOLATE",
    group: "H1A0A2A",
    title: "OpenBot Release Check Metadata Surface",
    matches: oneOf(
      exact("scripts/openclaw-npm-release-check.ts", "test/openclaw-npm-release-check.test.ts"),
    ),
  },
  {
    id: "isolate-openbot-package-json-metadata-surface",
    disposition: "ISOLATE",
    group: "H1A0A2B",
    title: "OpenBot Package JSON Metadata Surface",
    matches: oneOf(exact("package.json", ".oxfmtrc.jsonc")),
  },
  {
    id: "isolate-openbot-cli-launcher-wrapper-surface",
    disposition: "ISOLATE",
    group: "H1A0B1",
    title: "OpenBot CLI Launcher Wrapper Surface",
    matches: oneOf(
      exact(
        "openbot.mjs",
        "openclaw.mjs",
        "scripts/run-node.mjs",
        "src/infra/run-node.test.ts",
        "test/cli-json-stdout.e2e.test.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-cli-path-compatibility-surface",
    disposition: "ISOLATE",
    group: "H1A0B2",
    title: "OpenBot CLI PATH And Root Compatibility Surface",
    matches: oneOf(
      exact(
        "src/infra/openclaw-root.ts",
        "src/infra/openclaw-root.test.ts",
        "src/infra/path-env.test.ts",
        "src/infra/path-env.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-shell-installer-surface",
    disposition: "ISOLATE",
    group: "H1A1A",
    title: "OpenBot Shell Installer Surface",
    matches: oneOf(exact("scripts/install.sh", "src/install-sh-version.test.ts")),
  },
  {
    id: "isolate-openbot-installer-support-surface",
    disposition: "ISOLATE",
    group: "H1A1B",
    title: "OpenBot Installer Support Surface",
    matches: oneOf(exact("scripts/docker/install-sh-e2e/run.sh", "scripts/install.ps1")),
  },
  {
    id: "isolate-openbot-completion-surface",
    disposition: "ISOLATE",
    group: "H1A2A",
    title: "OpenBot Completion Surface",
    matches: oneOf(
      exact(
        "scripts/test-shell-completion.ts",
        "src/cli/completion-cli.ts",
        "src/commands/doctor-completion.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-update-cli-status-surface",
    disposition: "ISOLATE",
    group: "H1A2B",
    title: "OpenBot Update CLI And Status Surface",
    matches: oneOf(
      exact(
        "src/cli/update-cli.ts",
        "src/cli/update-cli/progress.test.ts",
        "src/cli/update-cli/progress.ts",
        "src/cli/update-cli/status.ts",
        "src/cli/update-cli/wizard.ts",
        "src/commands/doctor-update.ts",
        "src/commands/status.update.test.ts",
        "src/commands/status.update.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-update-execution-surface",
    disposition: "ISOLATE",
    group: "H1A2C",
    title: "OpenBot Update Execution Surface",
    matches: oneOf(
      exact(
        "src/cli/update-cli.test.ts",
        "src/cli/update-cli/shared.ts",
        "src/cli/update-cli/update-command.ts",
        "src/infra/update-global.ts",
        "src/infra/update-runner.test.ts",
        "src/infra/update-runner.ts",
        "src/infra/update-startup.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-cli-name-surface",
    disposition: "ISOLATE",
    group: "H1B1",
    title: "OpenBot CLI Name And Command Surface",
    matches: oneOf(
      exact(
        "src/cli/browser-cli-examples.ts",
        "src/cli/browser-cli-extension.ts",
        "src/cli/browser-cli.ts",
        "src/cli/channels-cli.ts",
        "src/cli/cli-name.ts",
        "src/cli/cli-name.test.ts",
        "src/cli/config-cli.ts",
        "src/cli/command-format.ts",
        "src/cli/command-format.test.ts",
        "src/cli/directory-cli.ts",
        "src/cli/hooks-cli.ts",
        "src/cli/logs-cli.ts",
        "src/cli/pairing-cli.ts",
        "src/cli/program/register.agent.ts",
        "src/cli/program/register.agent.test.ts",
        "src/cli/program/register.backup.ts",
        "src/cli/program/register.message.ts",
        "src/cli/program/register.status-health-sessions.ts",
        "src/cli/sandbox-cli.ts",
        "src/cli/security-cli.ts",
        "src/cli/tagline.ts",
        "src/entry.ts",
        "src/entry.version-fast-path.test.ts",
        "src/infra/infra-parsing.test.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-cli-help-surface",
    disposition: "ISOLATE",
    group: "H1B2",
    title: "OpenBot CLI Help Copy Surface",
    matches: oneOf(
      exact(
        "src/cli/help-format.ts",
        "src/cli/help-format.test.ts",
        "src/cli/program/help.ts",
        "src/cli/program/help.test.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-shared-verification",
    disposition: "ISOLATE",
    group: "H3",
    title: "OpenBot Shared Compatibility Verification",
    matches: oneOf(
      exact(
        "src/cli/profile.cli-surface.test.ts",
        "src/cli/profile.env.test.ts",
        "src/cli/profile.test.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-daemon-surface",
    disposition: "ISOLATE",
    group: "H1C",
    title: "OpenBot Daemon And Restart Surface",
    matches: oneOf(
      exact(
        "src/cli/argv.ts",
        "src/cli/daemon-cli/install.ts",
        "src/cli/daemon-cli/lifecycle-core.ts",
        "src/cli/daemon-cli/lifecycle.ts",
        "src/cli/daemon-cli/restart-health.ts",
        "src/cli/daemon-cli/lifecycle.test.ts",
        "src/cli/node-cli/daemon.ts",
        "src/cli/node-cli/register.ts",
        "src/cli/gateway-cli/run.ts",
        "src/cli/daemon-cli/shared.ts",
        "src/cli/daemon-cli/status.print.ts",
        "src/daemon/runtime-hints.test.ts",
        "src/commands/daemon-install-helpers.test.ts",
        "src/commands/daemon-install-helpers.ts",
        "src/commands/doctor-gateway-daemon-flow.ts",
        "src/cli/update-cli/restart-helper.test.ts",
        "src/cli/update-cli/restart-helper.ts",
        "src/daemon/constants.test.ts",
        "src/daemon/constants.ts",
        "src/daemon/inspect.ts",
        "src/daemon/launchd.test.ts",
        "src/daemon/launchd.ts",
        "src/daemon/node-service.ts",
        "src/daemon/paths.ts",
        "src/daemon/schtasks.install.test.ts",
        "src/daemon/schtasks.test.ts",
        "src/daemon/schtasks.ts",
        "src/daemon/service-env.test.ts",
        "src/daemon/service-env.ts",
        "src/daemon/systemd-unit.ts",
        "src/daemon/systemd.test.ts",
        "src/daemon/systemd.ts",
        "src/infra/gateway-process-argv.ts",
        "src/infra/restart-stale-pids.ts",
        "src/infra/windows-task-restart.test.ts",
        "src/infra/windows-task-restart.ts",
        "src/version.test.ts",
        "src/version.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-state-baseline",
    disposition: "ISOLATE",
    group: "H2",
    title: "OpenBot State And Migration Baseline",
    matches: oneOf(
      exact(
        "src/cli/profile.ts",
        "src/cli/run-main.ts",
        "src/config/config.nix-integration-u3-u5-u9.test.ts",
        "src/config/io.compat.test.ts",
        "src/config/paths.ts",
        "src/config/paths.test.ts",
        "src/commands/backup-shared.ts",
        "src/commands/backup-verify.test.ts",
        "src/commands/doctor-state-integrity.cloud-storage.test.ts",
        "src/commands/doctor-state-integrity.ts",
        "src/commands/doctor.warns-state-directory-is-missing.e2e.test.ts",
        "src/index.ts",
        "src/infra/env.test.ts",
        "src/infra/env.ts",
        "src/infra/exec-approvals.ts",
        "src/infra/home-dir.test.ts",
        "src/infra/home-dir.ts",
        "src/infra/state-migrations.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-cross-surface-compatibility",
    disposition: "ISOLATE",
    group: "H4",
    title: "OpenBot Cross-Surface Compatibility Shims",
    matches: oneOf(
      exact(
        "apps/android/app/src/main/java/ai/openclaw/app/node/ConnectionManager.kt",
        "apps/android/app/src/main/java/ai/openclaw/app/node/CanvasController.kt",
        "apps/android/app/src/main/java/ai/openclaw/app/SecurePrefs.kt",
        "apps/android/app/src/main/java/ai/openclaw/app/gateway/GatewaySession.kt",
        "apps/android/app/src/main/java/ai/openclaw/app/ui/CanvasScreen.kt",
        "apps/android/app/src/test/java/ai/openclaw/app/gateway/DeviceAuthPayloadTest.kt",
        "apps/android/app/src/test/java/ai/openclaw/app/gateway/BonjourEscapesTest.kt",
        "apps/android/app/src/test/java/ai/openclaw/app/gateway/GatewaySessionInvokeTest.kt",
        "apps/android/app/src/test/java/ai/openclaw/app/gateway/GatewaySessionInvokeTimeoutTest.kt",
        "apps/android/app/src/test/java/ai/openclaw/app/node/ConnectionManagerTest.kt",
        "apps/ios/ShareExtension/ShareViewController.swift",
        "apps/ios/Sources/Gateway/GatewayConnectionController.swift",
        "apps/ios/Sources/Gateway/GatewaySettingsStore.swift",
        "apps/ios/Sources/OpenClawApp.swift",
        "apps/ios/Tests/DeepLinkParserTests.swift",
        "apps/ios/Tests/GatewayConnectionControllerTests.swift",
        "apps/ios/Tests/GatewayConnectionSecurityTests.swift",
        "apps/ios/Tests/GatewayEndpointIDTests.swift",
        "apps/ios/Tests/GatewaySettingsStoreTests.swift",
        "apps/ios/Tests/KeychainStoreTests.swift",
        "apps/ios/Tests/NodeAppModelInvokeTests.swift",
        "apps/ios/Tests/ShareToAgentDeepLinkTests.swift",
        `${legacyMacAppSourceRoot}/CanvasWindowController+Navigation.swift`,
        `${legacyMacAppSourceRoot}/Constants.swift`,
        `${legacyMacAppSourceRoot}/GatewayLaunchAgentManager.swift`,
        `${legacyMacAppSourceRoot}/LaunchAgentManager.swift`,
        `${legacyMacAppSourceRoot}/NodeMode/MacNodeModeCoordinator.swift`,
        `${legacyMacAppSourceRoot}/ProcessInfo+OpenBot.swift`,
        "apps/macos/Sources/OpenBotMacCLI/ConnectCommand.swift",
        "apps/macos/Sources/OpenBotMacCLI/WizardCommand.swift",
        "apps/macos/Sources/OpenBotDiscovery/WideAreaGatewayDiscovery.swift",
        "apps/macos/Tests/OpenBotTests/NixModeStableSuiteTests.swift",
        "apps/macos/Tests/OpenBotTests/WideAreaGatewayDiscoveryTests.swift",
        "apps/shared/OpenClawKit/Sources/OpenBotKit/BonjourTypes.swift",
        "apps/shared/OpenClawKit/Sources/OpenBotKit/DeepLinks.swift",
        "apps/shared/OpenClawKit/Sources/OpenBotKit/GatewayChannel.swift",
        "apps/shared/OpenClawKit/Sources/OpenBotKit/GatewayEndpointID.swift",
        "apps/shared/OpenClawKit/Sources/OpenBotKit/GatewayNodeSession.swift",
        "apps/shared/OpenClawKit/Sources/OpenBotKit/GatewayTLSPinning.swift",
        "apps/shared/OpenClawKit/Sources/OpenBotKit/InstanceIdentity.swift",
        "apps/shared/OpenClawKit/Sources/OpenBotKit/Resources/CanvasScaffold/scaffold.html",
        "apps/shared/OpenClawKit/Sources/OpenBotKit/ShareGatewayRelaySettings.swift",
        "apps/shared/OpenClawKit/Sources/OpenBotKit/ShareToAgentDeepLink.swift",
        "apps/shared/OpenClawKit/Sources/OpenBotKit/ShareToAgentSettings.swift",
        "apps/shared/OpenClawKit/Sources/OpenBotKit/WebViewJavaScriptSupport.swift",
        "apps/shared/OpenClawKit/Tests/OpenBotKitTests/ChatMarkdownPreprocessorTests.swift",
        "apps/shared/OpenClawKit/Tests/OpenBotKitTests/ChatViewModelTests.swift",
        "apps/shared/OpenClawKit/Tests/OpenBotKitTests/DeepLinksSecurityTests.swift",
        "apps/shared/OpenClawKit/Tests/OpenBotKitTests/DeviceAuthPayloadTests.swift",
        "apps/shared/OpenClawKit/Tests/OpenBotKitTests/GatewayNodeSessionTests.swift",
        "apps/shared/OpenClawKit/Tools/CanvasA2UI/bootstrap.js",
        "src/compat/legacy-names.ts",
        "src/discord/components.test.ts",
        "src/discord/components.ts",
        "src/discord/monitor/agent-components.ts",
        "src/discord/monitor/thread-bindings.state.ts",
        "src/gateway/device-auth.test.ts",
        "src/gateway/test-helpers.server.ts",
        "src/hooks/internal-hooks.test.ts",
        "src/hooks/internal-hooks.ts",
        "src/memory/backend-config.ts",
        "src/memory/cogniweave-manager.test.ts",
        "src/memory/cogniweave-manager.ts",
        "src/memory/qmd-manager.test.ts",
        "src/memory/qmd-manager.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-app-canvas-a2ui-compat",
    disposition: "ISOLATE",
    group: "H5A",
    title: "OpenBot App Canvas A2UI Compatibility Surface",
    matches: oneOf(
      exact(
        "apps/android/app/src/main/java/ai/openclaw/app/node/A2UIHandler.kt",
        "apps/ios/Sources/Model/NodeAppModel+Canvas.swift",
        "apps/ios/Sources/Screen/ScreenController.swift",
        `${legacyMacAppSourceRoot}/CanvasA2UIActionMessageHandler.swift`,
        `${legacyMacAppSourceRoot}/CanvasManager.swift`,
        `${legacyMacAppSourceRoot}/NodeMode/MacNodeRuntime.swift`,
        "src/canvas-host/a2ui.ts",
        "src/canvas-host/a2ui/index.html",
        "src/canvas-host/server.test.ts",
        "src/canvas-host/server.ts",
        "src/canvas-host/server.state-dir.test.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-app-canvas-shell-copy",
    disposition: "ISOLATE",
    group: "H5B1A",
    title: "OpenBot App Canvas Shell Copy Surface",
    matches: oneOf(
      exact(
        "apps/android/app/src/main/java/ai/openclaw/app/ui/PostOnboardingTabs.kt",
        `${legacyMacAppSourceRoot}/CanvasWindowController+Window.swift`,
      ),
    ),
  },
  {
    id: "isolate-openbot-app-canvas-bridge",
    disposition: "ISOLATE",
    group: "H5B1B",
    title: "OpenBot App Canvas Deep-Link Bridge Surface",
    matches: oneOf(
      exact(
        "apps/ios/Sources/Screen/ScreenWebView.swift",
        `${legacyMacAppSourceRoot}/CanvasWindowController.swift`,
      ),
    ),
  },
  {
    id: "isolate-openbot-ios-node-canvas-identity",
    disposition: "ISOLATE",
    group: "H5B2",
    title: "OpenBot iOS Node Canvas Identity Surface",
    matches: oneOf(exact("apps/ios/Sources/Model/NodeAppModel.swift")),
  },
  {
    id: "isolate-openbot-app-shell-and-onboarding",
    disposition: "ISOLATE",
    group: "H6",
    title: "OpenBot App Shell And Onboarding Surface",
    matches: oneOf(
      exact(
        "apps/android/app/src/main/java/ai/openclaw/app/gateway/GatewayDiscovery.kt",
        "apps/android/app/src/main/java/ai/openclaw/app/NodeForegroundService.kt",
        "apps/android/app/src/main/java/ai/openclaw/app/PermissionRequester.kt",
        "apps/android/app/src/main/java/ai/openclaw/app/node/LocationHandler.kt",
        "apps/android/app/src/main/java/ai/openclaw/app/node/SystemHandler.kt",
        "apps/android/app/src/main/java/ai/openclaw/app/ui/OnboardingFlow.kt",
        "apps/android/app/src/main/java/ai/openclaw/app/ui/SettingsSheet.kt",
        "apps/android/app/src/main/java/ai/openclaw/app/ui/VoiceTabScreen.kt",
        "apps/android/app/src/main/res/values/strings.xml",
        "apps/android/scripts/perf-startup-hotspots.sh",
        "apps/ios/Sources/Gateway/DeepLinkAgentPromptAlert.swift",
        "apps/ios/Sources/Gateway/GatewayDiscoveryModel.swift",
        "apps/ios/Sources/Chat/IOSGatewayChatTransport.swift",
        "apps/ios/Sources/Device/NetworkStatusService.swift",
        "apps/ios/Sources/Info.plist",
        "apps/ios/Sources/LiveActivity/LiveActivityManager.swift",
        "apps/ios/Sources/LegacyShellPolicy.swift",
        "apps/ios/Sources/Onboarding/OnboardingWizardView.swift",
        "apps/ios/Sources/RootCanvas.swift",
        "apps/ios/Sources/RootView.swift",
        "apps/ios/Sources/Services/WatchMessagingService.swift",
        "apps/ios/Sources/Settings/SettingsTab.swift",
        "apps/ios/Sources/Settings/VoiceWakeWordsSettingsView.swift",
        "apps/ios/Sources/Voice/TalkModeManager.swift",
        "apps/ios/project.yml",
        "apps/macos/Package.swift",
        `${legacyMacAppSourceRoot}/AgentWorkspace.swift`,
        `${legacyMacAppSourceRoot}/CLIInstallPrompter.swift`,
        `${legacyMacAppSourceRoot}/CronJobEditor.swift`,
        `${legacyMacAppSourceRoot}/DebugSettings.swift`,
        `${legacyMacAppSourceRoot}/DeepLinks.swift`,
        `${legacyMacAppSourceRoot}/GatewayDiscoveryMenu.swift`,
        `${legacyMacAppSourceRoot}/GeneralSettings.swift`,
        `${legacyMacAppSourceRoot}/HealthStore.swift`,
        `${legacyMacAppSourceRoot}/InstancesSettings.swift`,
        `${legacyMacAppSourceRoot}/LegacyShellPolicy.swift`,
        `${legacyMacAppSourceRoot}/MenuBar.swift`,
        `${legacyMacAppSourceRoot}/MenuContentView.swift`,
        `${legacyMacAppSourceRoot}/OnboardingView+Chat.swift`,
        `${legacyMacAppSourceRoot}/OnboardingView+Pages.swift`,
        `${legacyMacAppSourceRoot}/PermissionsSettings.swift`,
        `${legacyMacAppSourceRoot}/RemoteTunnelManager.swift`,
        `${legacyMacAppSourceRoot}/Resources/Info.plist`,
        `${legacyMacAppSourceRoot}/VoiceWakeOverlay.swift`,
        `${legacyMacAppSourceRoot}/VoiceWakeSettings.swift`,
        `${legacyMacAppSourceRoot}/WebChatSwiftUI.swift`,
        "apps/macos/Sources/OpenBotDiscovery/GatewayDiscoveryModel.swift",
      ),
      prefix("apps/ios/fastlane/", "Swabble/"),
    ),
  },
  {
    id: "isolate-openbot-channel-and-extension-surface",
    disposition: "ISOLATE",
    group: "H1H",
    title: "OpenBot Channel And Extension Surface",
    matches: oneOf(
      prefix("assets/chrome-extension/", "extensions/"),
      exact("src/plugin-sdk/media-monitor.ts"),
    ),
  },
  {
    id: "isolate-openbot-android-app-identity-surface",
    disposition: "ISOLATE",
    group: "H1I1A1",
    title: "OpenBot Android App Identity Surface",
    matches: oneOf(exact("apps/android/app/build.gradle.kts")),
  },
  {
    id: "isolate-openbot-android-benchmark-identity-surface",
    disposition: "ISOLATE",
    group: "H1I1A2",
    title: "OpenBot Android Benchmark Identity Surface",
    matches: oneOf(
      exact(
        "apps/android/benchmark/build.gradle.kts",
        "apps/android/benchmark/src/main/java/ai/openclaw/app/benchmark/StartupMacrobenchmark.kt",
        "apps/android/scripts/perf-startup-benchmark.sh",
      ),
    ),
  },
  {
    id: "isolate-openbot-ios-config-xcconfig-identity-surface",
    disposition: "ISOLATE",
    group: "H1I1B1A1A",
    title: "OpenBot iOS Config Xcconfig Identity Surface",
    matches: oneOf(exact("apps/ios/Config/Signing.xcconfig")),
  },
  {
    id: "isolate-openbot-ios-manual-signing-xcconfig-identity-surface",
    disposition: "ISOLATE",
    group: "H1I1B1A1B",
    title: "OpenBot iOS Manual Signing Xcconfig Identity Surface",
    matches: oneOf(exact("apps/ios/Signing.xcconfig")),
  },
  {
    id: "isolate-openbot-ios-local-signing-example-identity-surface",
    disposition: "ISOLATE",
    group: "H1I1B1A2",
    title: "OpenBot iOS Local Signing Example Identity Surface",
    matches: oneOf(exact("apps/ios/LocalSigning.xcconfig.example")),
  },
  {
    id: "isolate-openbot-ios-beta-prepare-identity-surface",
    disposition: "ISOLATE",
    group: "H1I1B1B1",
    title: "OpenBot iOS Beta Prepare Identity Surface",
    matches: oneOf(exact("scripts/ios-beta-prepare.sh")),
  },
  {
    id: "isolate-openbot-ios-bundle-id-print-identity-surface",
    disposition: "ISOLATE",
    group: "H1I1B1B2",
    title: "OpenBot iOS Bundle Id Print Identity Surface",
    matches: oneOf(exact("scripts/ios-print-app-bundle-id.sh")),
  },
  {
    id: "isolate-openbot-ios-local-signing-helper-surface",
    disposition: "ISOLATE",
    group: "H1I1B2",
    title: "OpenBot iOS Local Signing Helper Surface",
    matches: oneOf(exact("scripts/ios-asc-keychain-setup.sh", "scripts/ios-configure-signing.sh")),
  },
  {
    id: "isolate-openbot-release-distribution-scripts",
    disposition: "ISOLATE",
    group: "H1I2",
    title: "OpenBot Release And Distribution Script Surface",
    matches: oneOf(
      exact(
        "scripts/auth-monitor.sh",
        "scripts/build-and-run-mac.sh",
        "scripts/build_icon.sh",
        "scripts/changelog-to-html.sh",
        "scripts/claude-auth-status.sh",
        "scripts/clawlog.sh",
        "scripts/codesign-mac-app.sh",
        "scripts/create-dmg.sh",
        "scripts/generate-host-env-security-policy-swift.mjs",
        "scripts/ios-write-version-xcconfig.sh",
        "scripts/label-open-issues.ts",
        "scripts/make_appcast.sh",
        "scripts/notarize-mac-artifact.sh",
        "scripts/package-mac-app.sh",
        "scripts/package-mac-dist.sh",
        "scripts/package-mac-adhoc-dist.sh",
        "scripts/protocol-gen.ts",
        "scripts/release-check.ts",
        "scripts/release-install-check.ts",
        "scripts/restart-mac.sh",
        "scripts/run-openclaw-podman.sh",
        "scripts/setup-auth-system.sh",
        "scripts/sync-plugin-versions.ts",
        "scripts/termux-auth-widget.sh",
        "scripts/termux-quick-auth.sh",
        "scripts/termux-sync-widget.sh",
        "scripts/write-cli-compat.ts",
      ),
      prefix(
        "scripts/dev/",
        "scripts/docs-i18n/",
        "scripts/mac/",
        "scripts/podman/",
        "scripts/shell-helpers/",
        "scripts/systemd/",
      ),
    ),
  },
  {
    id: "isolate-openbot-runtime-tail-surface",
    disposition: "ISOLATE",
    group: "H1J",
    title: "OpenBot Runtime Tail Surface",
    matches: oneOf(
      exact(
        "src/acp/server.ts",
        "src/agents/auth-profiles/doctor.ts",
        "src/agents/model-auth.ts",
        "src/agents/sandbox/browser.ts",
        "src/agents/sandbox/docker.ts",
        "src/agents/sandbox/runtime-status.ts",
        "src/agents/skills-install.ts",
        "src/agents/skills/workspace.ts",
        "src/agents/tool-display-common.ts",
        "src/auto-reply/reply/commands-acp/diagnostics.ts",
        "src/auto-reply/reply/commands-acp/install-hints.ts",
        "src/auto-reply/reply/directive-handling.shared.ts",
        "src/auto-reply/reply/elevated-unavailable.ts",
        "src/browser/chrome.ts",
        "src/browser/extension-relay-auth.test.ts",
        "src/browser/pw-session.get-page-for-targetid.extension-fallback.test.ts",
        "src/browser/pw-session.page-cdp.test.ts",
        "src/browser/pw-tools-core.responses.ts",
        "src/browser/server-lifecycle.test.ts",
        "src/browser/server-lifecycle.ts",
        "src/browser/server.ts",
        "src/cli/program/register.setup.ts",
        "src/config/io.write-config.test.ts",
        "src/config/talk-defaults.test.ts",
        "src/daemon/inspect.test.ts",
        "src/daemon/runtime-hints.windows-paths.test.ts",
        "src/daemon/service-audit.ts",
        "src/daemon/systemd-hints.test.ts",
        "src/daemon/systemd-hints.ts",
        "src/daemon/systemd-unit.test.ts",
        "src/hooks/gmail-ops.ts",
        "src/infra/host-env-security.policy-parity.test.ts",
        "src/infra/process-respawn.test.ts",
        "src/media/host.ts",
        "src/plugins/install.ts",
        "src/providers/qwen-portal-oauth.ts",
        "src/security/audit-channel.ts",
        "src/telegram/sendchataction-401-backoff.ts",
        "src/terminal/table.test.ts",
        "src/tui/tui.test.ts",
        "src/tui/tui.ts",
        "src/web/active-listener.ts",
        "src/web/auth-store.ts",
        "src/web/auto-reply/monitor.ts",
        "src/web/inbound/monitor.ts",
        "src/web/login-qr.ts",
        "src/web/login.ts",
        "src/web/session.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-browser-temp-and-download-surface",
    disposition: "ISOLATE",
    group: "H1E",
    title: "OpenBot Browser Temp And Download Surface",
    matches: oneOf(
      exact(
        "src/browser/output-atomic.ts",
        "src/browser/paths.ts",
        "src/browser/pw-tools-core.downloads.ts",
        "src/browser/pw-tools-core.interactions.set-input-files.test.ts",
        "src/browser/pw-tools-core.waits-next-download-saves-it.test.ts",
        "src/agents/sandbox-paths.test.ts",
        "src/cli/browser-cli-actions-input/register.files-downloads.ts",
        "src/cli/browser-cli-debug.ts",
        "src/infra/outbound/deliver.test.ts",
        "src/infra/outbound/message-action-runner.test.ts",
        "src/infra/tmp-openclaw-dir.test.ts",
        "src/infra/tmp-openclaw-dir.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-runtime-identity-surface",
    disposition: "ISOLATE",
    group: "H1F",
    title: "OpenBot Runtime Identity And Branding Surface",
    matches: oneOf(
      exact(
        "assets/chrome-extension/options-validation.js",
        "src/acp/translator.ts",
        "src/agents/identity.ts",
        "src/agents/internal-events.ts",
        "src/agents/model-fallback.test.ts",
        "src/agents/path-policy.test.ts",
        "src/agents/sandbox/validate-sandbox-security.ts",
        "src/agents/sandbox-create-args.test.ts",
        "src/agents/session-transcript-repair.ts",
        "src/agents/subagent-announce.format.e2e.test.ts",
        "src/agents/subagent-announce.ts",
        "src/agents/system-prompt.test.ts",
        "src/agents/system-prompt.ts",
        "src/agents/tool-display.test.ts",
        "src/agents/tools/web-tools.enabled-defaults.test.ts",
        "src/agents/tools/agents-list-tool.ts",
        "src/agents/tools/browser-tool.actions.ts",
        "src/agents/tools/browser-tool.ts",
        "src/auto-reply/status.ts",
        "src/auto-reply/commands-registry.data.ts",
        "src/auto-reply/reply/reply-utils.test.ts",
        "src/browser/bridge-server.ts",
        "src/browser/chrome-extension-options-validation.test.ts",
        "src/browser/client-fetch.loopback-auth.test.ts",
        "src/browser/client-fetch.ts",
        "src/browser/session-tab-registry.test.ts",
        "src/channels/plugins/pairing-message.ts",
        "src/cli/banner.test.ts",
        "src/cli/banner.ts",
        "src/cli/docs-cli.ts",
        "src/cli/nodes-cli/register.push.ts",
        "src/cli/plugins-cli.ts",
        "src/cli/program/command-registry.ts",
        "src/cli/program/register.subclis.ts",
        "src/cli/webhooks-cli.ts",
        "src/commands/chutes-oauth.ts",
        "src/commands/dashboard.links.test.ts",
        "src/commands/onboard-helpers.ts",
        "src/commands/status-all/report-lines.ts",
        "src/discord/monitor.test.ts",
        "src/discord/monitor.tool-result.accepts-guild-messages-mentionpatterns-match.e2e.test.ts",
        "src/discord/monitor/message-handler.preflight.test.ts",
        "src/discord/send.creates-thread.test.ts",
        "src/gateway/gateway-models.profiles.live.test.ts",
        "src/gateway/live-tool-probe-utils.test.ts",
        "src/gateway/openai-http.test.ts",
        "src/gateway/openai-http.ts",
        "src/gateway/openresponses-http.ts",
        "src/gateway/server-discovery.ts",
        "src/gateway/server-methods/nodes.ts",
        "src/gateway/server-methods/nodes.invoke-wake.test.ts",
        "src/gateway/server-methods/push.test.ts",
        "src/gateway/server-methods/push.ts",
        "src/infra/bonjour-discovery.test.ts",
        "src/infra/bonjour-discovery.ts",
        "src/infra/backup-create.ts",
        "src/infra/bonjour.test.ts",
        "src/infra/bonjour.ts",
        "src/infra/net/fetch-guard.ssrf.test.ts",
        "src/infra/outbound/targets.ts",
        "src/infra/push-apns.test.ts",
        "src/infra/ports.test.ts",
        "src/infra/ports.ts",
        "src/infra/provider-usage.fetch.minimax.test.ts",
        "src/infra/provider-usage.fetch.minimax.ts",
        "src/infra/runtime-guard.ts",
        "src/infra/shell-env.ts",
        "src/infra/unhandled-rejections.fatal-detection.test.ts",
        "src/infra/unhandled-rejections.ts",
        "src/infra/widearea-dns.ts",
        "src/infra/widearea-dns.test.ts",
        "src/line/probe.test.ts",
        "src/logging/env-log-level.ts",
        "src/logging/logger-env.test.ts",
        "src/logging/logger.ts",
        "src/telegram/bot-message-context.implicit-mention.test.ts",
        "src/telegram/bot-native-commands.session-meta.test.ts",
        "src/telegram/bot.test.ts",
        "src/web/media.ts",
        "src/web/auto-reply/web-auto-reply-utils.test.ts",
        "src/web/media.test.ts",
        "src/auto-reply/reply/commands-acp/shared.ts",
        "src/auto-reply/reply/commands-session.ts",
        "src/auto-reply/reply/groups.ts",
        "src/auto-reply/reply/inbound-meta.ts",
        "src/wizard/onboarding.finalize.ts",
        "src/wizard/onboarding.ts",
      ),
    ),
  },
  {
    id: "isolate-openbot-runtime-support-surface",
    disposition: "ISOLATE",
    group: "H1G",
    title: "OpenBot Runtime Support And Integration Surface",
    matches: oneOf(
      exact(
        "src/acp/client.ts",
        "src/acp/client.test.ts",
        "src/acp/persistent-bindings.types.ts",
        "src/acp/types.ts",
        "src/agents/auth-profiles/types.ts",
        "src/agents/kilocode-models.ts",
        "src/agents/minimax-vlm.ts",
        "src/agents/models-config.providers.ts",
        "src/agents/openclaw-tools.session-status.test.ts",
        "src/agents/pi-auth-json.ts",
        "src/agents/pi-embedded-helpers/errors.ts",
        "src/agents/pi-embedded-helpers/openai.ts",
        "src/agents/pi-embedded-runner-extraparams.test.ts",
        "src/agents/pi-embedded-runner/proxy-stream-wrappers.ts",
        "src/agents/pi-embedded-runner/utils.ts",
        "src/agents/pi-embedded-subscribe.tools.ts",
        "src/agents/pi-embedded-subscribe.tools.media.test.ts",
        "src/agents/pi-tools.ts",
        "src/agents/tool-images.ts",
        "src/agents/tools/web-search.ts",
        "src/auto-reply/reply.triggers.trigger-handling.filters-usage-summary-current-model-provider.cases.ts",
        "src/auto-reply/reply/session.ts",
        "src/auto-reply/reply/strip-inbound-meta.ts",
        "src/auto-reply/status.test.ts",
        "src/browser/config.ts",
        "src/browser/extension-relay-auth.ts",
        "src/browser/extension-relay.test.ts",
        "src/browser/extension-relay.ts",
        "src/browser/pw-session.page-cdp.ts",
        "src/browser/server-context.selection.ts",
        "src/gateway/hooks.test.ts",
        "src/gateway/hooks.ts",
        "src/gateway/server.hooks.test.ts",
        "src/channels/plugins/onboarding/helpers.ts",
        "src/channels/plugins/onboarding/imessage.ts",
        "src/channels/plugins/onboarding/slack.ts",
        "src/cli/nodes-cli/register.canvas.ts",
        "src/commands/agent.test.ts",
        "src/config/io.ts",
        "src/config/types.acp.ts",
        "src/config/types.base.ts",
        "src/config/types.discord.ts",
        "src/config/types.hooks.ts",
        "src/config/types.irc.ts",
        "src/config/types.openbot.ts",
        "src/discord/monitor/thread-bindings.discord-api.ts",
        "src/gateway/server-startup.ts",
        "src/hooks/bundled/README.md",
        "src/hooks/bundled/boot-md/HOOK.md",
        "src/hooks/bundled/bootstrap-extra-files/HOOK.md",
        "src/hooks/bundled/command-logger/HOOK.md",
        "src/hooks/bundled/session-memory/HOOK.md",
        "src/hooks/frontmatter.test.ts",
        "src/hooks/hooks-status.ts",
        "src/hooks/loader.ts",
        "src/media/input-files.ts",
        "src/memory/embeddings.ts",
        "src/pairing/pairing-messages.ts",
        "src/plugins/types.ts",
        "src/plugins/runtime/types-core.ts",
        "src/secrets/credential-matrix.ts",
        "src/secrets/provider-env-vars.ts",
        "src/security/audit-extra.async.ts",
        "src/security/audit-extra.sync.ts",
        "src/security/audit.ts",
        "src/slack/monitor/events/interactions.ts",
        "src/telegram/bot-message-context.acp-bindings.test.ts",
        "src/telegram/fetch.ts",
        "src/telegram/fetch.test.ts",
        "src/wizard/onboarding.gateway-config.ts",
      ),
    ),
  },
  {
    id: "merge-openbot-enterprise-usage-backend",
    disposition: "MERGE",
    group: "H1K",
    title: "OpenBot Enterprise Usage Backend Surface",
    matches: oneOf(
      exact(
        "src/gateway/agent-runtime-store.ts",
        "src/gateway/agent-runtime-seed.test.ts",
        "src/gateway/agent-runtime-seed.ts",
        "src/gateway/capability-governance-store.ts",
        "src/gateway/enterprise-seat-assets-backend.ts",
        "src/gateway/enterprise-seat-assets-governance.ts",
        "src/gateway/enterprise-seat-assets-store.ts",
        "src/gateway/enterprise-seat-assets.test.ts",
        "src/gateway/runtime-binding-sync.ts",
        "src/gateway/server-methods/agents-mutate.test.ts",
        "src/gateway/server-methods/agents.ts",
        "src/gateway/server-methods/agent-install-request.ts",
        "src/gateway/server-methods/agent-install-request.test.ts",
        "src/gateway/server-methods/employee-install.ts",
        "src/gateway/server-methods/employee-install.test.ts",
        "src/gateway/server-methods/enterprise-usage.ts",
        "src/gateway/server-methods/enterprise-usage.test.ts",
        "src/gateway/server-methods/usage.ts",
        "scripts/migrate-enterprise-seat-assets-to-sqlite.ts",
        "src/gateway/commerce/commerce-integration.test.ts",
      ),
    ),
  },
  {
    id: "merge-cost-budget-billing-backend",
    disposition: "MERGE",
    group: "J",
    title: "Cost Budget Billing Backend Surface",
    matches: oneOf(
      exact(
        "scripts/migrate-billing-version-lifecycle.ts",
        "src/gateway/server-methods/billing.ts",
        "src/gateway/server-methods/billing-helpers.ts",
        "src/gateway/server-methods/billing.test.ts",
        "src/gateway/server-methods/budget.ts",
        "src/gateway/server-methods/cost-control.ts",
        "src/gateway/server-methods/platform-plans.ts",
        "src/gateway/server-methods/resources.ts",
        "src/gateway/server-methods/seats.ts",
        "src/gateway/server-methods/subscriptions.ts",
        "src/gateway/server-methods/usage-ingest.ts",
      ),
      prefix("src/gateway/billing/"),
    ),
  },
  {
    id: "isolate-openbot-doctor-operator-surface",
    disposition: "ISOLATE",
    group: "H1D",
    title: "OpenBot Doctor And Operator Guidance Surface",
    matches: oneOf(
      exact(
        "docs/docs.json",
        "docs/help/debugging.md",
        "docs/help/faq.md",
        "docs/help/index.md",
        "docs/index.md",
        "docs/start/onboarding.md",
        "docs/start/docs-directory.md",
        "docs/start/hubs.md",
        "docs/start/setup.md",
        "docs/start/wizard-cli-reference.md",
        "docs/web/dashboard.md",
        "docs/zh-CN/help/index.md",
        "docs/zh-CN/index.md",
        "docs/zh-CN/channels/index.md",
        "docs/zh-CN/channels/enterprise-im.md",
        "docs/zh-CN/channels/wecom.md",
        "docs/zh-CN/channels/feishu.md",
        "docs/zh-CN/channels/dingtalk.md",
        "src/channels/plugins/helpers.ts",
        "src/channels/plugins/onboarding/signal.ts",
        "src/channels/plugins/onboarding/telegram.ts",
        "src/channels/plugins/onboarding/whatsapp.ts",
        "src/channels/plugins/status-issues/bluebubbles.ts",
        "src/channels/plugins/status-issues/whatsapp.ts",
        "src/channels/plugins/onboarding/whatsapp.test.ts",
        "src/cli/cron-cli/register.ts",
        "src/cli/dns-cli.ts",
        "src/cli/exec-approvals-cli.ts",
        "src/cli/gateway-cli.coverage.test.ts",
        "src/cli/gateway-cli/dev.ts",
        "src/cli/gateway-cli/register.ts",
        "src/cli/gateway-cli/shared.ts",
        "src/cli/memory-cli.ts",
        "src/cli/memory-cli.test.ts",
        "src/cli/nodes-cli/register.ts",
        "src/cli/program/config-guard.ts",
        "src/cli/qr-cli.ts",
        "src/cli/qr-cli.test.ts",
        "src/cli/skills-cli.format.ts",
        "src/commands/agent-via-gateway.ts",
        "src/commands/agent.ts",
        "src/commands/agents.commands.add.ts",
        "src/commands/auth-choice.apply-helpers.ts",
        "src/commands/channels/status.ts",
        "src/commands/agents.identity.test.ts",
        "src/commands/dashboard.ts",
        "src/commands/config-validation.ts",
        "src/commands/configure.wizard.ts",
        "src/commands/configure.channels.ts",
        "src/commands/configure.wizard.test.ts",
        "src/commands/docs.ts",
        "src/commands/doctor-auth.ts",
        "src/commands/doctor-config-flow.ts",
        "src/commands/doctor-config-flow.safe-bins.test.ts",
        "src/commands/doctor-cron.ts",
        "src/commands/doctor-format.ts",
        "src/commands/doctor-gateway-services.ts",
        "src/commands/doctor-gateway-services.test.ts",
        "src/commands/doctor-sandbox.ts",
        "src/commands/doctor-platform-notes.ts",
        "src/commands/doctor-platform-notes.startup-optimization.test.ts",
        "src/commands/doctor-memory-search.ts",
        "src/commands/doctor-memory-search.test.ts",
        "src/commands/doctor-session-locks.ts",
        "src/commands/doctor-security.test.ts",
        "src/commands/doctor-security.ts",
        "src/commands/doctor.ts",
        "src/commands/gateway-install-token.ts",
        "src/commands/gateway-install-token.test.ts",
        "src/commands/models/auth.ts",
        "src/commands/models.auth.provider-resolution.test.ts",
        "src/commands/models/auth.test.ts",
        "src/commands/models/list.status-command.ts",
        "src/commands/models/shared.ts",
        "src/commands/agents.commands.list.ts",
        "src/commands/onboard-channels.ts",
        "src/commands/onboard-hooks.ts",
        "src/commands/onboard-hooks.test.ts",
        "src/commands/onboard-non-interactive/local.ts",
        "src/commands/onboard-non-interactive/remote.ts",
        "src/commands/onboard-non-interactive.ts",
        "src/commands/onboard-remote.ts",
        "src/commands/onboard-search.ts",
        "src/commands/onboard-skills.ts",
        "src/commands/onboard.ts",
        "src/commands/reset.test.ts",
        "src/commands/reset.ts",
        "src/commands/sandbox-display.ts",
        "src/commands/status-all.ts",
        "src/commands/status.scan.ts",
        "src/commands/status.command.ts",
        "src/commands/status.service-summary.test.ts",
        "src/commands/status.test.ts",
        "src/commands/session-store-targets.ts",
        "src/commands/uninstall.ts",
        "src/commands/uninstall.test.ts",
        "src/infra/ports-format.ts",
        "src/infra/restart-sentinel.ts",
        "src/infra/tailscale.ts",
      ),
      prefix("docs/channels/"),
    ),
  },
  {
    id: "isolate-runtime-docs-and-guides",
    disposition: "ISOLATE",
    group: "I",
    title: "Runtime Docs And Platform Guides",
    matches: oneOf(
      exact(
        "apps/android/README.md",
        "apps/ios/README.md",
        "docs/concepts/architecture.md",
        "docs/concepts/typebox.md",
        "docs/gateway/bonjour.md",
        "docs/gateway/configuration-reference.md",
        "docs/gateway/discovery.md",
        "docs/gateway/index.md",
        "docs/gateway/network-model.md",
        "docs/gateway/protocol.md",
        "docs/gateway/security/index.md",
        "docs/install/nix.md",
        "docs/install/node.md",
        "docs/install/uninstall.md",
        "docs/install/updating.md",
        "docs/platforms/index.md",
        "docs/platforms/android.md",
        "docs/platforms/ios.md",
        "docs/platforms/mac/bundled-gateway.md",
        "docs/platforms/mac/canvas.md",
        "docs/platforms/mac/child-process.md",
        "docs/platforms/mac/dev-setup.md",
        "docs/platforms/mac/permissions.md",
        "docs/platforms/mac/release.md",
        "docs/platforms/mac/signing.md",
        "docs/platforms/macos.md",
      ),
    ),
  },
  {
    id: "merge-operational-identity-governance",
    disposition: "MERGE",
    group: "OIG",
    title: "Operational Identity Governance (attribution chain + monitoring + auth gate)",
    matches: oneOf(
      prefix(
        ".kiro/specs/operational-identity-governance/",
        "src/gateway/user-operational-identity",
        "src/gateway/server-methods/user-operational-identity",
        "src/gateway/enterprise-operational-identity",
        "src/gateway/server-methods/enterprise-operational-identity",
        "src/gateway/capability-attribution/",
        "src/gateway/scope-attribution",
        "ui/src/ui/controllers/user-operational-identity",
        "ui/src/ui/controllers/operational-identity-governance",
        "ui/src/ui/views/operational-identity-governance-panel",
      ),
      exact(
        ".env.example",
        "src/gateway/auth.platform-identity.test.ts",
        "src/gateway/server-methods/mesh-governance.ts",
      ),
    ),
  },
  {
    id: "merge-control-ui-auth",
    disposition: "MERGE",
    group: "B",
    title: "Control-UI And Platform Auth Recovery",
    matches: oneOf(
      exact(
        "docs/web/control-ui.md",
        "docs/gateway/trusted-proxy-auth.md",
        "src/commands/configure.gateway-auth.ts",
        "src/commands/configure.gateway.test.ts",
        "src/gateway/call.ts",
        "src/gateway/call.test.ts",
        "src/gateway/client.test.ts",
        "src/gateway/client.ts",
        "src/commands/configure.gateway.ts",
        "src/config/types.memory.ts",
        "src/gateway/enterprise-seat-assets.ts",
        "src/gateway/canvas-capability.ts",
        "src/gateway/protocol/client-info.ts",
        "src/gateway/server-startup-log.test.ts",
        "src/gateway/server-startup-log.ts",
        "src/gateway/server.canvas-auth.test.ts",
        "src/gateway/server-http.ts",
        "src/gateway/server.impl.ts",
        "src/gateway/server.control-ui-root.test.ts",
        "src/gateway/server-methods.control-plane-rate-limit.test.ts",
        "src/gateway/server-methods.domain-guard.test.ts",
        "src/gateway/server-methods/types.ts",
        "src/gateway/server/http-auth.ts",
        "src/gateway/server-methods/nodes.canvas-capability-refresh.test.ts",
        "src/gateway/server-methods/sessions.ts",
        "src/gateway/server/ws-connection/message-handler.ts",
        "src/gateway/server/ws-connection/auth-messages.ts",
        "src/gateway/server/ws-connection.ts",
        "src/gateway/server-ws-runtime.ts",
        "src/infra/canvas-host-url.ts",
        "src/infra/canvas-host-url.test.ts",
        "src/gateway/server/ws-types.ts",
        "src/gateway/gateway-misc.test.ts",
        "src/infra/control-ui-assets.test.ts",
        "src/infra/control-ui-assets.ts",
        "src/auto-reply/reply/inbound-meta.test.ts",
        "src/auto-reply/command-control.test.ts",
        "ui/package.json",
        "ui/vite.config.ts",
        "ui/src/ui/views/platform-auth-panel.ts",
        "src/gateway/server.ios-client-id.test.ts",
        "src/gateway/control-ui.ts",
        "src/gateway/control-ui.http.test.ts",
        "src/gateway/control-ui.auto-root.http.test.ts",
        "src/gateway/control-ui-http-utils.ts",
        "src/gateway/control-ui-csp.ts",
        "src/gateway/control-ui-csp.test.ts",
        "src/gateway/control-ui-shared.ts",
        "src/gateway/control-ui-routing.ts",
        "src/gateway/control-ui-routing.test.ts",
      ),
      prefix(
        "src/gateway/auth",
        "src/gateway/enterprise-seat-assets-audit",
        "src/gateway/platform-auth",
        "src/gateway/server.auth.",
        "src/gateway/session-utils",
        "ui/src/ui/app-gateway",
        "ui/src/ui/app-lifecycle",
        "ui/src/ui/controllers/control-ui-bootstrap",
        "ui/src/ui/controllers/platform-auth",
        "ui/src/ui/gateway",
      ),
    ),
  },
  {
    id: "merge-collaboration-runtime",
    disposition: "MERGE",
    group: "C",
    title: "Collaboration, Daibai, And Support-Case Runtime",
    matches: oneOf(
      exact(
        "src/gateway/collaboration-learning.ts",
        "src/gateway/collaboration-learning/space-store.ts",
        "src/gateway/protocol/index.ts",
        "src/gateway/protocol/index.test.ts",
        "src/gateway/protocol/schema.ts",
        "src/gateway/protocol/schema/frames.ts",
        "src/gateway/protocol/schema/protocol-schemas.ts",
        "src/gateway/protocol/schema/types.ts",
        "src/gateway/protocol/schema/collaboration.ts",
        "src/gateway/protocol/schema/daibai.ts",
        "src/gateway/server.chat.gateway-server-chat-b.test.ts",
        "src/gateway/server-methods/chat-scheduling.test.ts",
        "src/gateway/server-methods/spaces.test.ts",
        "src/gateway/server-methods/spaces.ts",
        "src/gateway/server-methods/steward-confirmation-store.ts",
        "src/gateway/server-methods/steward-confirmation-store.test.ts",
        "src/gateway/server-methods/devices.self-scope.test.ts",
        "src/shared/daibai-types.ts",
        "src/shared/daibai-action-catalog.ts",
        "src/shared/daibai-action-catalog.test.ts",
        "src/auto-reply/reply/dispatch-from-config.test.ts",
        "src/gateway/server-methods/employee-capability.ts",
        "src/auto-reply/reply/steward-chat-context.ts",
        "src/auto-reply/reply/operational-identity-context.ts",
        "src/auto-reply/reply/get-reply.ts",
        "scripts/worktree-audit.ts",
        "ui/src/ui/controllers/spaces.ts",
        "ui/src/ui/chat/evidence-drawer.ts",
        "ui/src/ui/views/artifact-sidebar.ts",
      ),
      prefix(
        ".kiro/specs/daibai-super-steward/",
        "docs/design/daibai-",
        "src/agents/builtin-steward/",
        "src/agents/workspace-run.ts",
        "src/gateway/collaboration-learning/",
        "src/gateway/collaboration-ledger/",
        "src/gateway/collaboration-dispatch/",
        "src/auto-reply/reply/runtime-context-assembly",
        "src/auto-reply/reply/session-continuity",
        "src/auto-reply/reply/steward-chat-context",
        "src/auto-reply/reply/operational-identity",
        "src/agents/pi-embedded-runner/run/attempt",
        "scripts/verify-collaboration-convergence.ts",
        "scripts/sync-collaboration-group-charter.ts",
        "scripts/migrate-collaboration-group-storage.ts",
        "src/gateway/employee-steward-session.ts",
        "src/auto-reply/reply/agent-runner",
        "src/auto-reply/reply/collaboration-",
        "src/gateway/server-methods/collaboration-learning",
        "src/gateway/server-methods/daibai",
        "src/gateway/server-methods/support-cases",
        "src/support-cases/",
        "ui/src/ui/controllers/collaboration-governance-actions",
        "ui/src/ui/controllers/collaboration-learning",
        "ui/src/ui/controllers/daibai",
        "ui/src/ui/chat/task-card-",
      ),
    ),
  },
  {
    id: "merge-edgsc-knowledge-supply",
    disposition: "MERGE",
    group: "EDGSC",
    title: "Enterprise Data Governance And Knowledge Universe M6",
    matches: oneOf(
      prefix("src/gateway/enterprise-data/", "src/gateway/knowledge/", "src/retrieval/"),
      prefix("src/gateway/server-methods/enterprise-data", "src/gateway/server-methods/knowledge"),
      exact(
        "src/gateway/server-methods.ts",
        "src/gateway/server-methods-list.ts",
        "src/gateway/method-scopes.ts",
        "src/auto-reply/reply/get-reply-run.ts",
        "src/auto-reply/reply/knowledge-universe-context.ts",
        "src/auto-reply/reply/knowledge-universe-context.test.ts",
        "src/auto-reply/reply/knowledge-universe-context.reply.test.ts",
        "src/auto-reply/templating.ts",
        "src/gateway/knowledge/reply-gateway-client.ts",
        "src/gateway/server-methods/chat.ts",
        "docs/design/openbot-knowledge-rag-integration-plan-2026-06-14.md",
        "docs/design/openbot-knowledge-rag-step1-report-2026-06-14.md",
        "docs/design/openbot-knowledge-rag-step2-report-2026-06-14.md",
        "docs/design/openbot-knowledge-workspace-optimization-2026-06-14.md",
        "docs/design/edgsc-m1-completion-report-2026-06-05.md",
        "docs/design/edgsc-m1-m2-realignment-report-2026-06-05.md",
        "docs/design/edgsc-m1-revalidation-report-2026-06-05.md",
        "docs/design/edgsc-m2-completion-report-2026-06-05.md",
        "docs/design/edgsc-m3-completion-report-2026-06-05.md",
        "docs/design/edgsc-m4-completion-report-2026-06-05.md",
        "docs/design/edgsc-m5-completion-report-2026-06-05.md",
        "docs/design/edgsc-m6-completion-report-2026-06-05.md",
        "docs/design/edgsc-master-implementation-plan-2026-06-05.md",
        "docs/design/enterprise-knowledge-supply-kernel.md",
        "docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md",
        "docs/design/openbot-knowledge-universe-final-task-plan-2026-06-05.md",
        "docs/design/openbot-knowledge-universe-m1-review-report-2026-06-05.md",
        "docs/design/openbot-knowledge-universe-m2-review-report-2026-06-05.md",
        "docs/design/openbot-knowledge-universe-m3-review-report-2026-06-05.md",
        "docs/design/openbot-knowledge-universe-m4-review-report-2026-06-05.md",
        "docs/design/openbot-knowledge-universe-m5-review-report-2026-06-05.md",
        "docs/design/approval-workflow-model.md",
        "docs/design/audit-runtime-schema.md",
        "docs/design/connector-action-versioning.md",
        "docs/design/data-classification-model.md",
        "docs/design/scope-policy-model.md",
      ),
    ),
  },
  {
    id: "merge-skill-lifecycle-backend",
    disposition: "MERGE",
    group: "K2",
    title: "Skill Lifecycle Backend Surface",
    matches: oneOf(
      exact(
        "src/commands/agents.config.ts",
        "src/gateway/capability-install-governance-store.ts",
        "src/gateway/server-methods/employee-capability.ts",
        "src/gateway/server-methods/employee-capability.test.ts",
        "src/gateway/server-methods/enterprise-capability.ts",
        "src/gateway/server-methods/enterprise-capability.test.ts",
        "src/gateway/server-methods/platform-capability.ts",
        "src/gateway/server-methods/platform-capability.test.ts",
        "src/gateway/skill-lifecycle-store.ts",
        "src/gateway/skill-lifecycle-store.test.ts",
        "src/gateway/server-methods/skill-lifecycle.ts",
        "src/gateway/server-methods/skill-lifecycle.test.ts",
      ),
    ),
  },
  {
    id: "merge-agent-growth-core",
    disposition: "MERGE",
    group: "AGS",
    title: "Agent Growth OS Core (P0A gateway kernel)",
    matches: prefix("src/gateway/agent-growth/"),
  },
  {
    id: "merge-workbench-ui",
    disposition: "MERGE",
    group: "A",
    title: "Workbench And Employee UI Recovery",
    matches: oneOf(
      exact(
        "ui/index.html",
        "ui/WORKSPACE_HOME_MODULE_MAP.md",
        "ui/src/styles.css",
        "ui/src/ui/views/asset-detail-sections.ts",
        "ui/src/ui/views/asset-detail-sections.test.ts",
        "ui/src/ui/views/asset-detail-tabs.ts",
        "ui/src/ui/views/asset-detail-tabs.test.ts",
        "ui/src/ui/views/asset-detail-vm.ts",
      ),
      prefix("ui/src/i18n/", "ui/src/styles/", "ui/src/ui/"),
    ),
  },
  {
    id: "isolate-package-incubation",
    disposition: "ISOLATE",
    group: "E",
    title: "Package Incubation And Package CI",
    matches: oneOf(
      exact(
        ".github/workflows/ci.yml",
        ".github/workflows/openclaw-npm-release.yml",
        "tsconfig.json",
        "tsconfig.plugin-sdk.dts.json",
        "tsdown.config.ts",
        "vitest.config.ts",
        "src/config/sessions/types.ts",
        "test/shims/tloncorp-api.ts",
        "packages/README.md",
        "docs/experiments/proposals/cogniweave-prd-v1.1.md",
      ),
      prefix(
        ".github/workflows/cogniweave-sdk-",
        "packages/cogniweave-sdk/",
        "packages/collaboration-core/",
        "packages/collaboration-openbot-adapter/",
        "packages/collaboration-runtime/",
        "test/shims/",
      ),
    ),
  },
  {
    id: "isolate-analysis-docs",
    disposition: "ISOLATE",
    group: "F",
    title: "Analysis, Specs, And Architecture Notes",
    matches: oneOf(
      exact(
        "AgentId规范化修复-验证清单.md",
        "OpenBot-Vision-v2.md",
        "OpenBot-Vision.md",
        "VISION.md",
        ...legacyAnalysisDocNames,
        "Pi-Coding-Agent-Integration-Guide.md",
        "docs/design/openbot-product-entry-matrix-2026-04-11.md",
        "docs/design/enterprise-ui-baseline.md",
      ),
      prefix(
        ".kiro/specs/",
        "docs/design/aegis-",
        "docs/design/install-sh-landing-",
        "docs/design/openbot-collaboration-learning-",
        "docs/design/openbot-collaboration-group-dialogue-",
        "docs/design/openbot-collaboration-group-response-orchestration-",
        "docs/design/openbot-multi-agent-collaboration-",
        "docs/design/openbot-four-port-",
        "docs/design/openbot-collaboration-sdk-",
        "docs/design/openbot-openclaw-ui-",
        "docs/design/multi-agent-worktree-orchestrator-",
        "docs/design/workbench-",
        "docs/design/worktree-",
        "src/shared/domain/",
        "src/fabric/",
        "src/gateway/fabric-v1-http",
        "src/gateway/server-methods/fabric.",
        "src/gateway/loom-attribution-source",
        "src/gateway/supervisor/",
        "src/gateway/server-methods/supervisor.",
        "src/gateway/server-node-events.ts",
        "src/gateway/node-command-policy.ts",
        "src/infra/node-commands.ts",
        "src/agents/cli-backend-",
        "src/agents/cli-runner.",
        "src/gateway/server-methods/cli-backend.",
        "ui/src/ui/ports/platform/advanced/cli-backend-panel",
        "ui/src/ui/ports/platform/advanced/supervisor-panel",
        "ui/src/ui/ports/platform/advanced/page.ts",
        "ui/src/ui/ports/employee/views/employee-supervisor-center",
        "ui/src/ui/supervisor/",
        "apps/macos/Sources/OpenBot/NodeMode/MacSupervisor",
        "apps/macos/Sources/OpenBot/SupervisorNodeBindSettingsSection.swift",
        "apps/shared/OpenClawKit/Sources/OpenBotKit/SupervisorWorkerCommands.swift",
        "src/config/types.agent-defaults.ts",
        "src/config/zod-schema.core.ts",
      ),
    ),
  },
  {
    id: "isolate-objective-shadow",
    disposition: "ISOLATE",
    group: "TFS",
    title: "Phase 2 Objective Resolver Shadow",
    matches: oneOf(prefix("src/objective-shadow/")),
  },
  {
    id: "isolate-conversation-task-runtime",
    disposition: "ISOLATE",
    group: "CTR",
    title: "ConversationTask Runtime",
    matches: oneOf(prefix("src/conversation-task/", ".kiro/specs/conversation-task-runtime/")),
  },
  {
    id: "merge-docs-rebrand",
    disposition: "MERGE",
    group: "RB",
    title: "Docs openclaw->openbot Rebrand Sweep",
    matches: exact(
      "docs/automation/cron-jobs.md",
      "docs/automation/gmail-pubsub.md",
      "docs/automation/webhook.md",
      "docs/cli/acp.md",
      "docs/cli/completion.md",
      "docs/cli/config.md",
      "docs/cli/doctor.md",
      "docs/cli/gateway.md",
      "docs/cli/index.md",
      "docs/cli/models.md",
      "docs/cli/node.md",
      "docs/cli/onboard.md",
      "docs/cli/plugins.md",
      "docs/cli/update.md",
      "docs/concepts/agent-workspace.md",
      "docs/concepts/memory.md",
      "docs/concepts/model-providers.md",
      "docs/concepts/multi-agent.md",
      "docs/concepts/oauth.md",
      "docs/diagnostics/flags.md",
      "docs/gateway/authentication.md",
      "docs/gateway/background-process.md",
      "docs/gateway/configuration.md",
      "docs/gateway/doctor.md",
      "docs/gateway/multiple-gateways.md",
      "docs/gateway/openai-http-api.md",
      "docs/gateway/openresponses-http-api.md",
      "docs/gateway/pairing.md",
      "docs/gateway/remote-gateway-readme.md",
      "docs/gateway/remote.md",
      "docs/gateway/sandboxing.md",
      "docs/gateway/secrets.md",
      "docs/gateway/tailscale.md",
      "docs/gateway/tools-invoke-http-api.md",
      "docs/help/environment.md",
      "docs/help/testing.md",
      "docs/install/development-channels.md",
      "docs/install/docker.md",
      "docs/install/gcp.md",
      "docs/install/hetzner.md",
      "docs/install/index.md",
      "docs/install/installer.md",
      "docs/install/migrating.md",
      "docs/install/podman.md",
      "docs/install/railway.mdx",
      "docs/install/render.mdx",
      "docs/logging.md",
      "docs/nodes/index.md",
      "docs/pi-dev.md",
      "docs/pi.md",
      "docs/platforms/raspberry-pi.md",
      "docs/reference/RELEASING.md",
      "docs/reference/prompt-caching.md",
      "docs/reference/test.md",
      "docs/reference/wizard.md",
      "docs/start/getting-started.md",
      "docs/tools/browser.md",
      "docs/tools/chrome-extension.md",
      "docs/tools/diffs.md",
      "docs/tools/exec.md",
      "docs/tools/multi-agent-sandbox-tools.md",
      "docs/tools/plugin.md",
      "docs/tts.md",
      "docs/vps.md",
      "docs/web/index.md",
      "docs/web/tui.md",
    ),
  },
  {
    id: "merge-monolith-decomposition",
    disposition: "MERGE",
    group: "MD",
    title: "Gateway Plugins Monolith Decomposition",
    matches: oneOf(
      exact(
        "src/plugins/loader.ts",
        "src/plugins/hooks.ts",
        "scripts/check-core-composition-root-loc.ts",
        "scripts/check-architecture-manifest.ts",
      ),
      prefix("scripts/architecture/", "src/plugins/loader/", "src/plugins/hooks/"),
    ),
  },
  // ─── macOS rebrand catch-all (after H4/H5/H6 exact rules which take priority) ───
  {
    id: "isolate-openbot-mac-rebrand",
    disposition: "ISOLATE",
    group: "HMAC",
    title: "OpenBot macOS Rename (OpenClaw to OpenBot)",
    matches: oneOf(prefix("apps/macos/", "apps/shared/OpenClawKit/")),
  },
  // ─── Straggler domain streams (non-rebrand WIP) ───
  {
    id: "merge-cron-delivery",
    disposition: "MERGE",
    group: "CRON",
    title: "Cron Delivery And Scheduling",
    matches: oneOf(prefix("src/cron/")),
  },
  {
    id: "merge-secrets-management",
    disposition: "MERGE",
    group: "SEC",
    title: "Secrets Management",
    matches: oneOf(prefix("src/secrets/")),
  },
  {
    id: "merge-workspaces",
    disposition: "MERGE",
    group: "WKS",
    title: "Workspaces Store",
    matches: oneOf(prefix("src/workspaces/")),
  },
  {
    id: "merge-agents-tooling",
    disposition: "MERGE",
    group: "AGT",
    title: "Agent Tooling And CLI Runner",
    matches: oneOf(prefix("src/agents/", "src/acp/", "src/commands/")),
  },
  {
    id: "merge-config-schemas",
    disposition: "MERGE",
    group: "CFG",
    title: "Configuration Schemas And Types",
    matches: oneOf(prefix("src/config/")),
  },
  {
    id: "merge-sessions",
    disposition: "MERGE",
    group: "SESS",
    title: "Sessions And Input Provenance",
    matches: oneOf(prefix("src/sessions/")),
  },
  {
    id: "merge-skills",
    disposition: "MERGE",
    group: "SKL",
    title: "Skills Plugins",
    matches: oneOf(
      prefix("skills/"),
      exact(
        "scripts/audit/apply-starter-pack-overlay.sh",
        "scripts/audit/starter-pack-delivery-smoke.mjs",
        "scripts/seed-capability-starter-packs.ts",
      ),
    ),
  },
  {
    id: "merge-development-supervisor-specs",
    disposition: "MERGE",
    group: "DSVR",
    title: "Development Supervisor Specs",
    matches: oneOf(prefix(".kiro/specs/development-supervisor", ".cursor/")),
  },
  {
    id: "merge-gateway-supervisor",
    disposition: "MERGE",
    group: "GWSV",
    title: "Gateway Supervisor And Protocol Extensions",
    matches: oneOf(
      prefix(
        "src/gateway/supervisor/",
        "src/gateway/server-methods/",
        "src/gateway/protocol/",
        "src/gateway/ai-workforce-governance/",
        "src/gateway/workbench/",
        "src/organization/",
      ),
      exact(
        "src/plugins/registry-types.ts",
        "src/gateway/capability-governance-store.test.ts",
        "src/gateway/skill-profile-field-meta.ts",
        "src/gateway/skill-asset-context-extract.test.ts",
        "src/gateway/collaboration-dispatch/directed-decision-reply.ts",
        "src/gateway/employee-workbench-scope.test.ts",
        "src/gateway/employee-workbench-scope.ts",
        "src/gateway/employee-workbench-scope.resolve-scoped.test.ts",
        "src/gateway/enterprise-org-departments.test.ts",
        "src/gateway/enterprise-org-departments.ts",
        "src/gateway/collaboration-org-bot-directory.test.ts",
        "src/gateway/collaboration-org-bot-directory.ts",
        "src/gateway/enterprise-seat-assets-store.snapshot.test.ts",
        "src/gateway/agent-tenant.test.ts",
        "src/gateway/server-chat.ts",
        "src/gateway/server-chat.agent-events.test.ts",
        "src/gateway/tenant-canonicalization.ts",
        "src/gateway/tenant-canonicalization.test.ts",
        "src/gateway/tenant-config.test.ts",
        "src/infra/openbot-root.test.ts",
      ),
    ),
  },
  {
    id: "merge-enterprise-ui",
    disposition: "MERGE",
    group: "EUI",
    title: "Enterprise UI And Platform Views",
    matches: oneOf(prefix("ui/", ".kiro/specs/enterprise-ui-baseline/")),
  },
  {
    id: "merge-design-docs",
    disposition: "MERGE",
    group: "DDOC",
    title: "Design Documents (Straggler)",
    matches: oneOf(prefix("docs/design/")),
  },
];

function parseStatus(output: Buffer): StatusEntry[] {
  const tokens = output.toString("utf8").split("\0");
  const entries: StatusEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    const xy = token.slice(0, 2);
    const path = token.slice(3);
    if (xy.includes("R") || xy.includes("C")) {
      const originalPath = tokens[index + 1] || undefined;
      entries.push({ xy, path, originalPath });
      index += 1;
      continue;
    }
    entries.push({ xy, path });
  }
  return entries;
}

function parseCachedPaths(output: Buffer): StatusEntry[] {
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => ({
      xy: "M ",
      path,
    }));
}

function statusKind(entry: StatusEntry) {
  if (entry.xy === "??") {
    return "untracked";
  }
  if (entry.xy.includes("D")) {
    return "deleted";
  }
  if (entry.xy.includes("A")) {
    return "added";
  }
  if (entry.xy.includes("R")) {
    return "renamed";
  }
  return "modified";
}

/**
 * Loom cutover (registry-gated): when a committed `.loom/registry.yaml` exists,
 * the Registry's landingStreams become the rule source; otherwise the legacy
 * hardcoded table is used. Behavior is identical until a registry is committed
 * (M1 parity, `loom check`). The hardcoded `LEGACY_RULES` are removed only in
 * task 6.3 once the team commits a registry + Wave 2 sync is in place.
 */
function policyToDisposition(policy: LandingPolicy): AuditRule["disposition"] {
  switch (policy) {
    case "exclusive":
      return "ISOLATE";
    case "manual":
      return "CLEAN";
    default:
      return "MERGE"; // serial + parallel both display as MERGE (parallel ← legacy group D)
  }
}

function buildRulesFromRegistry(registry: Registry): AuditRule[] {
  return registry.landingStreams.map((stream) => {
    const regexps = stream.paths.map(globToRegExp);
    const title =
      typeof stream.metadata?.legacyTitle === "string" ? stream.metadata.legacyTitle : stream.id;
    return {
      id: stream.id,
      disposition: policyToDisposition(stream.landingPolicy),
      group: stream.id,
      title,
      matches: (path: string) => regexps.some((re) => re.test(path)),
    };
  });
}

// `LOOM_FORCE_LEGACY=1` forces the legacy table even when a Registry is present
// (used by `loom check` to obtain a true legacy baseline post-cutover).
const activeRegistry: Registry | null =
  !process.env.LOOM_FORCE_LEGACY && existsSync(registryPath()) ? loadRegistry() : null;
const rules: AuditRule[] = activeRegistry ? buildRulesFromRegistry(activeRegistry) : LEGACY_RULES;

/** Map Loom's policy-based risky-mix result back to the legacy `{ rules, message }` shape. */
function toLegacyRiskyMix(
  loom: { message: string; streams: Array<{ streamId: string }> } | null,
): { rules: AuditRule[]; message: string } | null {
  if (!loom) {
    return null;
  }
  const byGroup = new Map(rules.map((rule) => [rule.group, rule] as const));
  return {
    message: loom.message,
    rules: loom.streams
      .map((stream) => byGroup.get(stream.streamId))
      .filter((rule): rule is AuditRule => rule != null),
  };
}

function classify(entries: StatusEntry[]): ClassifiedEntry[] {
  return entries.map((entry) => ({
    ...entry,
    rule: rules.find((rule) => rule.matches(entry.path)) ?? null,
  }));
}

function summarizeByRule(entries: ClassifiedEntry[]) {
  const summary = new Map<
    string,
    {
      rule: AuditRule | null;
      entries: ClassifiedEntry[];
      kinds: Record<string, number>;
    }
  >();
  for (const entry of entries) {
    const key = entry.rule?.id ?? "unmatched";
    const bucket = summary.get(key) ?? {
      rule: entry.rule,
      entries: [],
      kinds: {},
    };
    bucket.entries.push(entry);
    const kind = statusKind(entry);
    bucket.kinds[kind] = (bucket.kinds[kind] ?? 0) + 1;
    summary.set(key, bucket);
  }
  return [...summary.values()].toSorted(
    (left, right) => right.entries.length - left.entries.length,
  );
}

function filterByGroup(entries: ClassifiedEntry[], group: string | null) {
  if (!group) {
    return entries;
  }
  return entries.filter((entry) => entry.rule?.group === group);
}

function groupEntriesByKind(entries: ClassifiedEntry[]) {
  const buckets: Record<string, ClassifiedEntry[]> = {
    modified: [],
    added: [],
    deleted: [],
    renamed: [],
    untracked: [],
  };
  for (const entry of entries) {
    buckets[statusKind(entry)].push(entry);
  }
  return buckets;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function loadEntries() {
  if (cached) {
    const output = execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMRD", "-z"],
      {
        cwd: process.cwd(),
      },
    );
    return parseCachedPaths(output);
  }
  const output = execFileSync("git", ["status", "--porcelain=v1", "-z"], {
    cwd: process.cwd(),
  });
  return parseStatus(output);
}

function loadOverlapPaths(revision: string | null) {
  if (!revision) {
    return null;
  }
  const output = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", `${revision}^1`, revision],
    {
      cwd: process.cwd(),
    },
  );
  return new Set(
    output
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function filterByOverlap(
  entries: ClassifiedEntry[],
  overlapPaths: Set<string> | null,
  mode: "all" | "overlap-only" | "current-only",
) {
  if (!overlapPaths || mode === "all") {
    return entries;
  }
  return entries.filter((entry) => {
    const inOverlap = overlapPaths.has(entry.path);
    return mode === "overlap-only" ? inOverlap : !inOverlap;
  });
}

const allowedLinkedPrimaryGroups = [
  new Set(["H1I1B1A1A", "H1I1B1A1B", "H1I1B1B1"]),
  new Set(["H5A", "G"]),
  new Set(["EDGSC", "D"]),
  // Shared gateway scope registry carries both knowledge-universe (EDGSC) and entitlement (ME) deltas.
  new Set(["EDGSC", "ME"]),
  // Memory Center manage/forget path1 spans list (ACL) + lifecycle (CL).
  new Set(["CL", "ACL"]),
];

function isAllowedLinkedPrimaryGroupMix(primaryRules: AuditRule[]) {
  const groups = new Set(primaryRules.map((rule) => rule.group));
  return allowedLinkedPrimaryGroups.some(
    (allowedGroups) =>
      groups.size === allowedGroups.size &&
      Array.from(groups).every((group) => allowedGroups.has(group)),
  );
}

function findRiskyMix(entries: ClassifiedEntry[]) {
  const activeRules = Array.from(
    new Map(
      entries
        .filter((entry) => entry.rule !== null)
        .map((entry) => [entry.rule!.group, entry.rule!] as const),
    ).values(),
  );
  if (activeRules.length <= 1) {
    return null;
  }
  const primaryRules = activeRules.filter((rule) => rule.group !== "D");
  if (primaryRules.length === 0) {
    return null;
  }
  if (primaryRules.length === 1 && primaryRules[0]?.group !== "G") {
    return null;
  }
  if (isAllowedLinkedPrimaryGroupMix(primaryRules)) {
    return null;
  }
  return {
    rules: activeRules,
    message:
      "Staged changes span multiple landing groups. Stage one primary group at a time; Group D may accompany one group, but mixed primary groups are blocked.",
  };
}

// ── Exports for Loom import + parity (see .kiro/specs/loom-workspace-orchestrator) ──
// These let `scripts/loom/import.ts` read the legacy rule table as data without
// duplicating it, and let parity tests freeze it as the golden reference.
export { rules, LEGACY_RULES, allowedLinkedPrimaryGroups };
export type { AuditRule };

/** Reconstruct the literal exact/prefix patterns a rule was built from. */
export function extractRulePatterns(rule: AuditRule): { exact: string[]; prefix: string[] } {
  const matcher = rule.matches as PatternMatcher;
  return { exact: matcher.__exact ?? [], prefix: matcher.__prefix ?? [] };
}

function runCli() {
  const overlapMode = overlapOnly ? "overlap-only" : currentOnly ? "current-only" : "all";
  if (overlapOnly && currentOnly) {
    throw new Error("Use only one of --overlap-only or --current-only.");
  }
  if ((overlapOnly || currentOnly) && !overlapWith) {
    throw new Error("--overlap-only/--current-only require --overlap-with <revision>.");
  }

  const entries = loadEntries();
  const classified = classify(entries);
  const overlapPaths = loadOverlapPaths(overlapWith);
  const filtered = filterByOverlap(
    filterByGroup(classified, selectedGroup),
    overlapPaths,
    overlapMode,
  );
  const unmatched = filtered.filter((entry) => entry.rule === null);
  const grouped = summarizeByRule(filtered);
  const riskyMix =
    selectedGroup !== null
      ? null
      : activeRegistry
        ? toLegacyRiskyMix(loomFindRiskyMix(loomClassify(activeRegistry, entries)))
        : findRiskyMix(classified);
  const overlapCount =
    overlapPaths === null ? null : filtered.filter((entry) => overlapPaths.has(entry.path)).length;

  if (pathsOnly) {
    for (const entry of filtered) {
      process.stdout.write(`${entry.path}\n`);
    }
    process.exit(0);
  }

  if (manifest) {
    const buckets = groupEntriesByKind(filtered);
    const orderedKinds: Array<keyof typeof buckets> = [
      "modified",
      "added",
      "deleted",
      "renamed",
      "untracked",
    ];
    if (selectedGroup) {
      console.log(`Group ${selectedGroup} Landing Manifest`);
    } else {
      console.log("Landing Manifest");
    }
    console.log(`- total entries: ${filtered.length}`);
    for (const kind of orderedKinds) {
      const entriesForKind = buckets[kind];
      if (entriesForKind.length === 0) {
        continue;
      }
      console.log(`- ${kind}: ${entriesForKind.length}`);
      for (const entry of entriesForKind) {
        const renameSuffix = entry.originalPath ? ` <- ${entry.originalPath}` : "";
        console.log(`  - ${entry.path}${renameSuffix}`);
      }
    }
    process.exit(0);
  }

  if (stagePlan) {
    const buckets = groupEntriesByKind(filtered);
    const stageWithAdd = [
      ...buckets.modified,
      ...buckets.added,
      ...buckets.untracked,
      ...buckets.renamed,
    ];
    const stageWithUpdate = buckets.deleted;

    if (selectedGroup) {
      console.log(`# Stage plan for group ${selectedGroup}`);
    } else {
      console.log("# Stage plan");
    }
    console.log("# Dry-run only. Review before executing.");

    if (stageWithAdd.length > 0) {
      console.log(`git add -- ${stageWithAdd.map((entry) => shellQuote(entry.path)).join(" ")}`);
    }

    if (stageWithUpdate.length > 0) {
      console.log(
        `git add -u -- ${stageWithUpdate.map((entry) => shellQuote(entry.path)).join(" ")}`,
      );
    }

    if (stageWithAdd.length === 0 && stageWithUpdate.length === 0) {
      console.log("# No matching paths.");
    }

    process.exit(0);
  }

  if (json) {
    const payload = {
      total: filtered.length,
      unmatched: unmatched.length,
      cached,
      group: selectedGroup,
      overlapWith,
      overlapMode,
      overlapCount,
      riskyMix:
        riskyMix === null
          ? null
          : {
              message: riskyMix.message,
              groups: riskyMix.rules.map((rule) => ({
                disposition: rule.disposition,
                group: rule.group,
                title: rule.title,
              })),
            },
      groups: grouped.map((bucket) => ({
        id: bucket.rule?.id ?? "unmatched",
        disposition: bucket.rule?.disposition ?? "UNMATCHED",
        group: bucket.rule?.group ?? "-",
        title: bucket.rule?.title ?? "Unmatched",
        count: bucket.entries.length,
        kinds: bucket.kinds,
        paths: bucket.entries.map((entry) => entry.path),
      })),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(
      (failOnUnmatched && unmatched.length > 0) || (failOnRiskyMix && riskyMix !== null) ? 1 : 0,
    );
  }

  console.log(cached ? "Worktree Audit (cached)" : "Worktree Audit");
  if (selectedGroup) {
    console.log(`- selected group: ${selectedGroup}`);
  }
  if (overlapWith) {
    console.log(`- overlap with: ${overlapWith}`);
    console.log(`- overlap mode: ${overlapMode}`);
    console.log(`- overlap entries: ${overlapCount ?? 0}`);
  }
  console.log(`- total entries: ${filtered.length}`);
  console.log(`- unmatched entries: ${unmatched.length}`);

  for (const bucket of grouped) {
    const title = bucket.rule
      ? `${bucket.rule.disposition} ${bucket.rule.group}: ${bucket.rule.title}`
      : "UNMATCHED";
    const kindSummary = Object.entries(bucket.kinds as Record<string, number>)
      .map(([kind, count]) => `${kind}=${count}`)
      .join(", ");
    console.log(`- ${title} (${bucket.entries.length}; ${kindSummary})`);
    if (!verbose) {
      continue;
    }
    for (const entry of bucket.entries) {
      const renameSuffix = entry.originalPath ? ` <- ${entry.originalPath}` : "";
      console.log(`  - ${entry.xy} ${entry.path}${renameSuffix}`);
    }
  }

  if (unmatched.length > 0) {
    console.error("");
    console.error("Unmatched paths need an explicit disposition before landing.");
    console.error(
      "Give them one by adding or extending a `landingStreams` entry in " +
        ".loom/registry.yaml (see .loom/README.md). Editing LEGACY_RULES in this " +
        "script has no effect while that registry exists.",
    );
  }

  if (riskyMix !== null) {
    console.error("");
    console.error(riskyMix.message);
    for (const rule of riskyMix.rules) {
      console.error(`- ${rule.disposition} ${rule.group}: ${rule.title}`);
    }
  }

  process.exit(
    (failOnUnmatched && unmatched.length > 0) || (failOnRiskyMix && riskyMix !== null) ? 1 : 0,
  );
}

// Run the CLI only when invoked directly (e.g. pre-commit, `pnpm worktree:audit`),
// so the module can be imported by Loom for its rule table without side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
