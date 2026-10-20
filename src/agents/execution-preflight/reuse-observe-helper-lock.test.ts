/**
 * Path A / ABC Knife2 — reuse-observe helper regression lock.
 *
 * Locks the six already-wired observe-only helpers against
 * `allowed-entry-disposition.ts` (#87). No shared shell extracted this turn:
 * per-entry param shaping differs enough that extraction would not reduce
 * risk without a larger refactor; prefer this lock + existing per-entry tests.
 *
 * Start-order id: `phase_c_83_path_a_observe_helper_lock_start_order` (#88).
 * Claim ceiling: code-present. No new soft-observe; C10 still cannot pass;
 * NO-GO COMPLETE; unique-benefit FAIL; 合入 ≠ PASS/GO; Path B not included.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV,
  isAcpCliSteerPreflightObserveEnabled,
} from "../../acp/cli-steer-preflight-observe.js";
import {
  ACP_TURN_PREFLIGHT_OBSERVE_ENV,
  isAcpTurnPreflightObserveEnabled,
} from "../../auto-reply/reply/dispatch-acp.js";
import {
  ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE_ENV,
  isEnterpriseCapabilityInvokePreflightObserveEnabled,
} from "../../gateway/enterprise-data/capability-agent-invoke-runtime.js";
import {
  NODE_INVOKE_PREFLIGHT_OBSERVE_ENV,
  isNodeInvokePreflightObserveEnabled,
} from "../../gateway/server-methods/nodes.js";
import {
  HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE_ENV,
  isHttpToolsInvokePreflightObserveEnabled,
} from "../../gateway/tools-invoke-http.js";
import {
  INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV,
  isInterAgentBusPreflightObserveEnabled,
} from "../../organization/inter-agent-bus.js";
import {
  ALLOWED_ENTRY_DISPOSITIONS,
  dispositionForEntry,
  type AllowedEntryId,
} from "./allowed-entry-disposition.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

/** Frozen inventory aligned with #87 reuse-observe rows + #88 Path A scope §1. */
const REUSE_OBSERVE_HELPERS: ReadonlyArray<{
  entry: AllowedEntryId;
  envName: string;
  envConstant: string;
  siteRelPath: string;
  /** Private or exported observe entrypoint name present in the site source. */
  observeFn: string;
  isEnabled: (env?: NodeJS.ProcessEnv) => boolean;
}> = [
  {
    entry: "FC-01 /tools/invoke",
    envName: "OPENBOT_HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE",
    envConstant: HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE_ENV,
    siteRelPath: "src/gateway/tools-invoke-http.ts",
    observeFn: "observeHttpToolsInvokePreflight",
    isEnabled: isHttpToolsInvokePreflightObserveEnabled,
  },
  {
    entry: "FC-03a enterprise capability invoke",
    envName: "OPENBOT_ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE",
    envConstant: ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE_ENV,
    siteRelPath: "src/gateway/enterprise-data/capability-agent-invoke-runtime.ts",
    observeFn: "observeEnterpriseCapabilityInvokePreflight",
    isEnabled: isEnterpriseCapabilityInvokePreflightObserveEnabled,
  },
  {
    entry: "FC-03b node.invoke",
    envName: "OPENBOT_NODE_INVOKE_PREFLIGHT_OBSERVE",
    envConstant: NODE_INVOKE_PREFLIGHT_OBSERVE_ENV,
    siteRelPath: "src/gateway/server-methods/nodes.ts",
    observeFn: "observeNodeInvokePreflight",
    isEnabled: isNodeInvokePreflightObserveEnabled,
  },
  {
    entry: "FC-05 ACP in-process tryDispatchAcpReply",
    envName: "OPENBOT_ACP_TURN_PREFLIGHT_OBSERVE",
    envConstant: ACP_TURN_PREFLIGHT_OBSERVE_ENV,
    siteRelPath: "src/auto-reply/reply/dispatch-acp.ts",
    observeFn: "observeAcpInProcessTurnPreflight",
    isEnabled: isAcpTurnPreflightObserveEnabled,
  },
  {
    entry: "FC-06 inter-agent bus",
    envName: "OPENBOT_INTER_AGENT_BUS_PREFLIGHT_OBSERVE",
    envConstant: INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV,
    siteRelPath: "src/organization/inter-agent-bus.ts",
    observeFn: "observeInterAgentBusPreflight",
    isEnabled: isInterAgentBusPreflightObserveEnabled,
  },
  {
    entry: "FC-07 ACP CLI + steer",
    envName: "OPENBOT_ACP_CLI_STEER_PREFLIGHT_OBSERVE",
    envConstant: ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV,
    siteRelPath: "src/acp/cli-steer-preflight-observe.ts",
    observeFn: "observeAcpCliSteerPreflight",
    isEnabled: isAcpCliSteerPreflightObserveEnabled,
  },
];

function readRepoFile(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), "utf8");
}

/**
 * Extract the source of `function <name>(...) { ... }` including nested braces.
 * Used to assert observe bodies never apply/arm (file-level may still mention
 * those symbols in comments elsewhere — body scope is the contract).
 */
function extractFunctionSource(source: string, fnName: string): string {
  const re = new RegExp(`(?:export\\s+)?function\\s+${fnName}\\s*\\(`, "m");
  const match = re.exec(source);
  expect(match, `missing function ${fnName}`).toBeTruthy();
  const start = match!.index;

  // Walk from the opening `(` of the parameter list to its matching `)`.
  let i = source.indexOf("(", start);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }

  // Skip whitespace and an optional TypeScript return type (`: void`, unions, etc.).
  while (i < source.length && /\s/.test(source[i])) {
    i++;
  }
  if (source[i] === ":") {
    i++;
    let angle = 0;
    let paren = 0;
    let bracket = 0;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "<") {
        angle++;
      } else if (ch === ">") {
        angle = Math.max(0, angle - 1);
      } else if (ch === "(") {
        paren++;
      } else if (ch === ")") {
        paren = Math.max(0, paren - 1);
      } else if (ch === "[") {
        bracket++;
      } else if (ch === "]") {
        bracket = Math.max(0, bracket - 1);
      } else if (ch === "{" && angle === 0 && paren === 0 && bracket === 0) {
        break; // function body
      }
    }
  }
  while (i < source.length && /\s/.test(source[i])) {
    i++;
  }
  expect(source[i], `${fnName} body start`).toBe("{");

  depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unclosed body for ${fnName}`);
}

describe("reuse-observe helper lock (Path A / ABC Knife2)", () => {
  it("locks exactly six reuse-observe disposition rows from #87", () => {
    const reuseRows = ALLOWED_ENTRY_DISPOSITIONS.filter(
      (row) => row.disposition === "reuse-observe",
    );
    expect(reuseRows).toHaveLength(REUSE_OBSERVE_HELPERS.length);
    expect(REUSE_OBSERVE_HELPERS).toHaveLength(6);
    for (const helper of REUSE_OBSERVE_HELPERS) {
      expect(dispositionForEntry(helper.entry)).toBe("reuse-observe");
      const row = ALLOWED_ENTRY_DISPOSITIONS.find((r) => r.entry === helper.entry);
      expect(row?.disposition).toBe("reuse-observe");
    }
  });

  it("keeps ENV names stable (exported constants match frozen strings)", () => {
    for (const helper of REUSE_OBSERVE_HELPERS) {
      expect(helper.envConstant).toBe(helper.envName);
      const source = readRepoFile(helper.siteRelPath);
      expect(source).toContain(helper.envName);
      expect(source).toContain(`"${helper.envName}"`);
    }
  });

  it("keeps each observe flag default-off", () => {
    for (const helper of REUSE_OBSERVE_HELPERS) {
      expect(helper.isEnabled({}), `${helper.envName} empty env`).toBe(false);
      expect(helper.isEnabled({ [helper.envName]: "" }), `${helper.envName} empty string`).toBe(
        false,
      );
      expect(helper.isEnabled({ [helper.envName]: "0" }), `${helper.envName} 0`).toBe(false);
      expect(helper.isEnabled({ [helper.envName]: "1" }), `${helper.envName} 1`).toBe(true);
    }
  });

  it("documents observe contract: buildExecutionPreflight only; never apply/arm", () => {
    for (const helper of REUSE_OBSERVE_HELPERS) {
      const source = readRepoFile(helper.siteRelPath);
      expect(source, helper.siteRelPath).toContain("buildExecutionPreflight");
      expect(source, helper.siteRelPath).toContain(helper.observeFn);

      const body = extractFunctionSource(source, helper.observeFn);
      expect(body, helper.observeFn).toContain("buildExecutionPreflight");
      // Returned allow set must be discarded — no apply / arm on observe path.
      expect(body, `${helper.observeFn} must not apply`).not.toContain("applyPreflightToTools");
      expect(body, `${helper.observeFn} must not arm`).not.toContain("armCompletionHold");
      // File-level lock for these six sites: none of them import apply/arm.
      expect(source, `${helper.siteRelPath} file`).not.toContain("applyPreflightToTools");
      expect(source, `${helper.siteRelPath} file`).not.toContain("armCompletionHold");
    }
  });

  it("does not add a seventh OPENBOT_* observe flag at the six sites", () => {
    const known = new Set(REUSE_OBSERVE_HELPERS.map((h) => h.envName));
    for (const helper of REUSE_OBSERVE_HELPERS) {
      const source = readRepoFile(helper.siteRelPath);
      const found = source.match(/OPENBOT_[A-Z0-9_]*PREFLIGHT_OBSERVE/g) ?? [];
      for (const name of found) {
        expect(known.has(name), `unexpected flag ${name} in ${helper.siteRelPath}`).toBe(true);
      }
    }
  });

  it("is not exported from the preflight barrel (lock stays discovery/test-side)", () => {
    const barrel = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(barrel).not.toContain("reuse-observe-helper-lock");
    expect(barrel).not.toContain("observe-only-preflight");
  });
});
