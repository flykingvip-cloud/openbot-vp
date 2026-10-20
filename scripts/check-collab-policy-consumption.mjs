#!/usr/bin/env node
/**
 * Floor Runtime v2.1 §5.5 P1-A4 — lint:collab:policy-consumption (AST guard, final shape).
 *
 * Purpose: every remaining policy bypass (BP-xx in §1.3) in runtime consumer code must
 * sit in exactly one capability-lane bucket of POLICY_CONSUMPTION_ALLOWLIST:
 *   ① participation  ② dispatch  ③ governance  ④ context  ⑤ presentation
 *
 * Gate (zero behaviour change; this script only reads source):
 *   - a finding with no allowlist entry                → FAIL (new bypass)
 *   - a finding count above its entry's count          → FAIL (bypass grew)
 *   - an entry whose count is above the findings count → FAIL (stale; shrink the bucket)
 *   - a finding whose inferred lane ≠ its bucket lane  → FAIL (mis-bucketed)
 *   - aliasing `facts.legacyReads` as a whole object   → FAIL (never allowlistable:
 *     it hides field-level lane accounting)
 * So "bucket count == remaining bypass count" holds exactly at all times.
 *
 * P1-A5 (④ → ⑤ → ① → ② → ③): each sub-PR migrates a lane to
 * authority.policy.effective.* and deletes that lane's entries. Phase 1-A final gate:
 * every bucket is [] (allowlist = []).
 * P1-A5 ④: context bucket is [] (consumers → policy-lane-context.ts).
 * P1-A5 ⑤: presentation bucket is [] (BP-14 → policy-lane-presentation.ts).
 * P1-A5 ①: participation bucket is [] (BP-01/02/04/05/BP-18 → policy-lane-participation.ts).
 * P1-A5 ②: dispatch bucket is [] (BP-03/BP-06..10/BP-13 → policy-lane-dispatch.ts).
 * P1-A5 ③ (this change): governance bucket is [] (BP-15/16 → policy-lane-governance.ts)
 *   — allowlist = [] (Phase 1-A consumption allowlist cleared).
 * P1-A5 final gate: LegacyPolicyReads type + facts.legacyReads deleted; detector retained
 *   so any regression reintroducing the bypass fails closed.
 *
 * Detected bypass shapes (reads only; assignment targets are ignored):
 *   legacy-reads-field   `<x>.legacyReads.<field>` / `?.` / ["field"] / destructuring
 *   raw-collaboration-policy  `.collaborationPolicy` (whole object or `.collaborationPolicy.<field>`)
 *   raw-collaboration-mode    `<..>.groupProfile.collaborationMode`            (BP-13)
 *   multi-source-coordinator  `.coordinatorBotId` on governance/managedSpace/groupProfile,
 *                             `runtimeOrganizationContext.coordinator`          (BP-15/16)
 *   raw-confidentiality       `.confidentialityTier` on session overlay/profile (BP-12)
 *   policy-v1-context         `<policyV1>.contextPolicy` read (BP-11; PolicyV1 context slice)
 *   policy-recompile          compile* / resolveCollaborationPolicyV1 calls outside the
 *                             composition root (BP-18)
 *
 * Composition-root whitelist (not scanned): runtime-authority.ts, round-policy-snapshot.ts,
 * resolve-effective-policy.ts, policy-compiler*.ts, legacy-policy-view.ts (P1-A3 derived
 * view), effective-policy.ts (types), policy-migration-event.ts (P1-A2 migration infra),
 * the P1-A5 lane helpers policy-lane-context.ts (④) / policy-lane-presentation.ts (⑤) /
 * policy-lane-participation.ts (①) / policy-lane-dispatch.ts (②) /
 * policy-lane-governance.ts (③),
 * and in chat.ts the body of buildGroupRuntimeAuthority().
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  collectTypeScriptFilesFromRoots,
  resolveRepoRoot,
  runAsScript,
  toLine,
} from "./lib/ts-guard-utils.mjs";

export const LANES = Object.freeze([
  "participation",
  "dispatch",
  "governance",
  "context",
  "presentation",
]);

export const DISPATCH_ROOT = "src/gateway/collaboration-dispatch";
export const EXTRA_CONSUMER_FILES = Object.freeze([
  "src/gateway/server-methods/chat.ts",
  "src/auto-reply/reply/get-reply-run.ts",
]);

export const COMPOSITION_ROOT_FILES = new Set([
  "runtime-authority.ts",
  "round-policy-snapshot.ts",
  "resolve-effective-policy.ts",
  "legacy-policy-view.ts",
  "effective-policy.ts",
  "policy-migration-event.ts",
  "policy-lane-context.ts",
  "policy-lane-presentation.ts",
  "policy-lane-participation.ts",
  "policy-lane-dispatch.ts",
  "policy-lane-governance.ts",
]);

/** Functions whose body is composition root even inside a scanned file. */
export const COMPOSITION_ROOT_FUNCTIONS = new Set(["buildGroupRuntimeAuthority"]);

/** Retired LegacyPolicyReads field → lane map (detector retained post-deletion). */
export const LEGACY_READS_FIELD_LANE = Object.freeze({
  maxVisibleRaw: "participation", // BP-01
  maxVisibleBroadRaw: "participation", // BP-02
  charterInputs: "participation", // BP-04/05
  tier1MergeRaw: "dispatch", // BP-03
  policyV1: "dispatch", // BP-06..10
  collaborationModeRaw: "dispatch", // BP-13
  contextPolicyV1: "context", // BP-11/12
  replyLanguageRaw: "presentation", // BP-14
  coordinatorCandidates: "governance", // BP-15/16
});

/** operatingState.collaborationPolicy.<field> → lane. Unknown fields: lane null. */
export const RAW_POLICY_FIELD_LANE = Object.freeze({
  maxVisibleBotRepliesPerRound: "participation",
  maxVisibleBotRepliesPerRoundBroad: "participation",
  mentionBotMustRespond: "participation",
  openDiscussionWithoutMention: "participation",
  humanStartsNewRound: "participation",
  mentionHumanNotifiesOnly: "participation",
  allowSupplementAfterPrimary: "dispatch",
  coordinatorSummarizeAfterRound: "dispatch",
  dutyFloor: "dispatch",
  proactiveReplyThreshold: "dispatch",
  dutyWeight: "dispatch",
  relevanceWeight: "dispatch",
  botMaySelfAdvanceWithoutHuman: "governance",
  entersWaitingForHumanAfterVisibleTurnsExhausted: "governance",
  replyLanguage: "presentation",
});

const RECOMPILE_CALLEES = new Set([
  "compileEffectivePolicyFromScope",
  "compileEffectivePolicyFromOperatingState",
  "compileGroupEffectivePolicy",
  "compileEffectiveCollaborationPolicy",
  "resolveCollaborationPolicyV1",
]);

const COORDINATOR_SOURCE_RECEIVERS = new Set(["governance", "managedSpace", "groupProfile"]);
const CONFIDENTIALITY_RECEIVERS = new Set([
  "collaborationParticipationOverlay",
  "collaborationGroupProfile",
]);

/**
 * Remaining bypasses, bucketed by lane. Each entry: exact (file, rule, detail) and count.
 * Shrink only. P1-A5 deletes a lane's entries; the Phase 1-A end state is all buckets [].
 */
export const POLICY_CONSUMPTION_ALLOWLIST = Object.freeze({
  // ① participation — BP-01, BP-02, BP-04/05, BP-18 — cleared by P1-A5 ①
  // (consumers → policy-lane-participation.ts; charter dead branch deleted)
  participation: [],
  // ② dispatch — BP-03, BP-06..10, BP-13 — cleared by P1-A5 ②
  // (consumers → policy-lane-dispatch.ts)
  dispatch: [],
  // ③ governance — BP-15/16 — cleared by P1-A5 ③
  // (consumers → policy-lane-governance.ts)
  governance: [],
  // ④ context — BP-11, BP-12 — cleared by P1-A5 ④ (consumers → policy-lane-context.ts)
  context: [],
  // ⑤ presentation — BP-14 — cleared by P1-A5 ⑤ (consumer → policy-lane-presentation.ts)
  presentation: [],
});

export function isConsumerFile(relPath) {
  const normalized = relPath.split(path.sep).join("/");
  if (EXTRA_CONSUMER_FILES.includes(normalized)) {
    return true;
  }
  if (!normalized.startsWith(`${DISPATCH_ROOT}/`)) {
    return false;
  }
  if (
    /\.test\.tsx?$/.test(normalized) ||
    normalized.includes(".scan-fixture.") ||
    normalized.includes("/__fixtures__/") ||
    normalized.endsWith(".d.ts")
  ) {
    return false;
  }
  const base = path.basename(normalized);
  if (COMPOSITION_ROOT_FILES.has(base) || /^policy-compiler.*\.tsx?$/i.test(base)) {
    return false;
  }
  return true;
}

function lastName(expr) {
  let e = expr;
  while (e && (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e))) {
    e = e.expression;
  }
  if (!e) {
    return null;
  }
  if (ts.isIdentifier(e)) {
    return e.text;
  }
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) {
    return e.name.text;
  }
  if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression)) {
    return e.argumentExpression.text;
  }
  return null;
}

/** Member name accessed by `node` (property or string-literal element access), else null. */
function accessedName(node) {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

function isMemberAccess(node) {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

function isAssignmentTarget(node) {
  const parent = node.parent;
  return (
    parent &&
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  );
}

/** Parent member access that dereferences `node` further (`node.x`), if any. */
function parentMember(node) {
  const parent = node.parent;
  if (parent && isMemberAccess(parent) && parent.expression === node) {
    return parent;
  }
  return null;
}

function enclosingFunctionName(node) {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (
      (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) &&
      cur.name &&
      ts.isIdentifier(cur.name)
    ) {
      if (COMPOSITION_ROOT_FUNCTIONS.has(cur.name.text)) {
        return cur.name.text;
      }
    }
    if (
      (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) &&
      cur.parent &&
      ts.isVariableDeclaration(cur.parent) &&
      ts.isIdentifier(cur.parent.name) &&
      COMPOSITION_ROOT_FUNCTIONS.has(cur.parent.name.text)
    ) {
      return cur.parent.name.text;
    }
  }
  return null;
}

/**
 * @param {string} content
 * @param {string} fileName
 * @returns {Array<{ line: number; rule: string; detail: string; lane: string | null; bp: string }>}
 */
export function findPolicyConsumptionFindings(content, fileName = "source.ts") {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  const findings = [];
  const report = (node, rule, detail, lane, bp) => {
    if (enclosingFunctionName(node)) {
      return;
    }
    findings.push({ line: toLine(sourceFile, node), rule, detail, lane, bp });
  };

  const visit = (node) => {
    const name = isMemberAccess(node) ? accessedName(node) : null;

    if (name === "legacyReads" && !isAssignmentTarget(node)) {
      const deref = parentMember(node);
      const field = deref ? accessedName(deref) : null;
      if (field) {
        report(
          deref,
          "legacy-reads-field",
          `legacyReads.${field}`,
          LEGACY_READS_FIELD_LANE[field] ?? null,
          "BP-01..16",
        );
      } else if (
        node.parent &&
        ts.isVariableDeclaration(node.parent) &&
        node.parent.initializer === node &&
        ts.isObjectBindingPattern(node.parent.name)
      ) {
        for (const el of node.parent.name.elements) {
          const key = el.propertyName ?? el.name;
          const fieldName = ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : null;
          if (fieldName) {
            report(
              el,
              "legacy-reads-field",
              `legacyReads.${fieldName}`,
              LEGACY_READS_FIELD_LANE[fieldName] ?? null,
              "BP-01..16",
            );
          }
        }
      } else {
        report(node, "legacy-reads-alias", "legacyReads (whole object)", null, "BP-01..16");
      }
    } else if (name === "collaborationPolicy" && !isAssignmentTarget(node)) {
      const deref = parentMember(node);
      const field = deref ? accessedName(deref) : null;
      if (field && isAssignmentTarget(deref)) {
        // write path (settings editor), not consumption
      } else if (field) {
        report(
          deref,
          "raw-collaboration-policy",
          `collaborationPolicy.${field}`,
          RAW_POLICY_FIELD_LANE[field] ?? null,
          field === "replyLanguage" ? "BP-14" : "BP-01..10",
        );
      } else {
        report(node, "raw-collaboration-policy", "collaborationPolicy", null, "BP-04/05");
      }
    } else if (
      name === "collaborationMode" &&
      lastName(node.expression) === "groupProfile" &&
      !isAssignmentTarget(node)
    ) {
      report(node, "raw-collaboration-mode", "groupProfile.collaborationMode", "dispatch", "BP-13");
    } else if (
      name === "coordinatorBotId" &&
      COORDINATOR_SOURCE_RECEIVERS.has(lastName(node.expression) ?? "") &&
      !isAssignmentTarget(node)
    ) {
      report(
        node,
        "multi-source-coordinator",
        `${lastName(node.expression)}.coordinatorBotId`,
        "governance",
        "BP-15/16",
      );
    } else if (
      name === "coordinator" &&
      lastName(node.expression) === "runtimeOrganizationContext" &&
      !isAssignmentTarget(node)
    ) {
      report(
        node,
        "multi-source-coordinator",
        "runtimeOrganizationContext.coordinator",
        "governance",
        "BP-15",
      );
    } else if (
      name === "confidentialityTier" &&
      CONFIDENTIALITY_RECEIVERS.has(lastName(node.expression) ?? "") &&
      !isAssignmentTarget(node)
    ) {
      report(
        node,
        "raw-confidentiality",
        `${lastName(node.expression)}.confidentialityTier`,
        "context",
        "BP-12",
      );
    } else if (name === "contextPolicy" && !isAssignmentTarget(node)) {
      report(node, "policy-v1-context", "PolicyV1.contextPolicy", "context", "BP-11");
    } else if (ts.isCallExpression(node)) {
      const callee = lastName(node.expression);
      if (callee && RECOMPILE_CALLEES.has(callee)) {
        report(node, "policy-recompile", `${callee}()`, null, "BP-18");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function entryKey(e) {
  return `${e.file}\u0000${e.rule}\u0000${e.detail}`;
}

/**
 * Pure gate: compare findings against the bucketed allowlist.
 * @returns {{ errors: string[]; laneCounts: Record<string, number> }}
 */
export function evaluatePolicyConsumption(findings, allowlist = POLICY_CONSUMPTION_ALLOWLIST) {
  const errors = [];
  const laneCounts = Object.fromEntries(LANES.map((l) => [l, 0]));
  const bucketKeys = Object.keys(allowlist);
  for (const k of bucketKeys) {
    if (!LANES.includes(k)) {
      errors.push(`allowlist: unknown lane bucket "${k}" (expected one of ${LANES.join(", ")})`);
    }
  }
  for (const lane of LANES) {
    if (!Array.isArray(allowlist[lane])) {
      errors.push(`allowlist: missing lane bucket "${lane}"`);
    }
  }

  /** @type {Map<string, { lane: string; entry: any }>} */
  const allowed = new Map();
  for (const lane of LANES) {
    for (const entry of allowlist[lane] ?? []) {
      const key = entryKey(entry);
      if (allowed.has(key)) {
        errors.push(
          `allowlist: duplicate entry ${entry.file} [${entry.rule}] ${entry.detail} (in "${allowed.get(key).lane}" and "${lane}")`,
        );
        continue;
      }
      if (!Number.isInteger(entry.count) || entry.count < 1) {
        errors.push(`allowlist: ${entry.file} [${entry.rule}] ${entry.detail} count must be ≥ 1`);
      }
      allowed.set(key, { lane, entry });
    }
  }

  /** @type {Map<string, { finding: any; lines: number[] }>} */
  const grouped = new Map();
  for (const f of findings) {
    const key = entryKey(f);
    const g = grouped.get(key) ?? { finding: f, lines: [] };
    g.lines.push(f.line);
    grouped.set(key, g);
  }

  for (const [key, { finding, lines }] of grouped) {
    const where = `${finding.file}:${lines.join(",")} [${finding.rule}] ${finding.detail}`;
    if (finding.rule === "legacy-reads-alias") {
      errors.push(`${where}: aliasing legacyReads is never allowlistable — read a field directly`);
      continue;
    }
    const hit = allowed.get(key);
    if (!hit) {
      errors.push(
        `${where} (${finding.bp}, lane=${finding.lane ?? "?"}): new policy bypass — read authority.policy.effective.* instead`,
      );
      continue;
    }
    if (finding.lane && finding.lane !== hit.lane) {
      errors.push(`${where}: bucketed in "${hit.lane}" but belongs to lane "${finding.lane}"`);
    }
    if (lines.length > hit.entry.count) {
      errors.push(`${where}: ${lines.length} sites > allowlisted ${hit.entry.count} (bypass grew)`);
    }
    laneCounts[hit.lane] += lines.length;
  }

  for (const [key, { lane, entry }] of allowed) {
    const found = grouped.get(key)?.lines.length ?? 0;
    if (found < entry.count) {
      errors.push(
        `allowlist[${lane}]: ${entry.file} [${entry.rule}] ${entry.detail} allows ${entry.count} but ${found} remain — shrink the bucket`,
      );
    }
  }
  return { errors, laneCounts };
}

export async function collectPolicyConsumptionFindings(repoRoot) {
  const files = await collectTypeScriptFilesFromRoots([
    path.join(repoRoot, DISPATCH_ROOT),
    ...EXTRA_CONSUMER_FILES.map((rel) => path.join(repoRoot, rel)),
  ]);
  const findings = [];
  let scanned = 0;
  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    if (!isConsumerFile(rel)) {
      continue;
    }
    scanned += 1;
    const content = await fs.readFile(file, "utf8");
    for (const f of findPolicyConsumptionFindings(content, file)) {
      findings.push({ file: rel, ...f });
    }
  }
  return { scanned, findings };
}

export async function main(argv = process.argv.slice(2)) {
  const repoRoot = resolveRepoRoot(import.meta.url);
  const { scanned, findings } = await collectPolicyConsumptionFindings(repoRoot);
  if (argv.includes("--report")) {
    console.log(JSON.stringify(findings, null, 2));
    return;
  }
  const { errors, laneCounts } = evaluatePolicyConsumption(findings);
  const summary = LANES.map((l) => `${l}=${laneCounts[l]}`).join(" ");
  if (errors.length > 0) {
    console.error("Collaboration policy consumption guard failed (Floor Runtime v2.1 §5.5 P1-A4):");
    for (const e of errors) {
      console.error(`- ${e}`);
    }
    console.error(`lane buckets: ${summary}`);
    process.exit(1);
  }
  const total = Object.values(laneCounts).reduce((a, b) => a + b, 0);
  console.log(
    `lint:collab:policy-consumption ok (${scanned} consumer files, remaining bypass sites=${total}: ${summary})`,
  );
}

runAsScript(import.meta.url, main);
