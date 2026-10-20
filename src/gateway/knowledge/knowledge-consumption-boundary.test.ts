// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const knowledgeRoot = path.dirname(fileURLToPath(import.meta.url));
const gatewayRoot = path.resolve(knowledgeRoot, "..");

const FORBIDDEN_PATTERNS = [
  /invokeEnterpriseDataAction/,
  /enterprise-data\/data-gateway/,
  /enterprise-data-gateway/,
  /knowledgeDataInvoke/,
];

function listTypeScriptFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("knowledge consumption boundary", () => {
  it("does not import or call enterprise data gateway from knowledge plane", () => {
    const offenders: string[] = [];
    for (const filePath of listTypeScriptFiles(knowledgeRoot)) {
      const content = fs.readFileSync(filePath, "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          offenders.push(`${path.relative(knowledgeRoot, filePath)}: ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not register knowledge.data.invoke gateway method", () => {
    const methodList = fs.readFileSync(path.join(gatewayRoot, "server-methods-list.ts"), "utf8");
    const methodScopes = fs.readFileSync(path.join(gatewayRoot, "method-scopes.ts"), "utf8");
    const knowledgeHandlers = fs.readFileSync(
      path.join(gatewayRoot, "server-methods/knowledge.ts"),
      "utf8",
    );
    expect(methodList).not.toContain("knowledge.data.invoke");
    expect(methodScopes).not.toContain("knowledge.data.invoke");
    expect(knowledgeHandlers).not.toContain("knowledge.data.invoke");
    expect(methodList).not.toContain("knowledge.publish.execute");
    expect(methodScopes).not.toContain("knowledge.publish.execute");
    expect(knowledgeHandlers).not.toContain("knowledge.publish.execute");
  });

  it("does not host gateway-calling supply schedulers", () => {
    const offenders: string[] = [];
    for (const filePath of listTypeScriptFiles(knowledgeRoot)) {
      const content = fs.readFileSync(filePath, "utf8");
      if (
        content.includes("runProjectionMaterialization") ||
        content.includes("tickScheduledProjectionMaterialization") ||
        content.includes("ensureOnDemandProjectionsMaterialized") ||
        content.includes("invokeEnterpriseDataAction")
      ) {
        offenders.push(path.relative(knowledgeRoot, filePath));
      }
    }
    expect(offenders).toEqual([]);
    expect(
      fs.existsSync(path.join(knowledgeRoot, "feed/scheduled-projection-materializer.ts")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(knowledgeRoot, "feed/on-demand-projection-materializer.ts")),
    ).toBe(false);
  });

  it("does not materialize projections while loading the knowledge universe", () => {
    const sourceBundle = fs.readFileSync(path.join(knowledgeRoot, "source-bundle.ts"), "utf8");
    const router = fs.readFileSync(path.join(knowledgeRoot, "router.ts"), "utf8");
    const enterpriseFeed = fs.readFileSync(
      path.join(knowledgeRoot, "feed/enterprise-feed-adapter.ts"),
      "utf8",
    );
    const dataCapabilityFeed = fs.readFileSync(
      path.join(knowledgeRoot, "feed/data-capability-feed-adapter.ts"),
      "utf8",
    );
    for (const source of [sourceBundle, router, enterpriseFeed, dataCapabilityFeed]) {
      expect(source).not.toContain("ensureOnDemandProjectionsMaterialized");
      expect(source).not.toContain("runProjectionMaterialization");
      expect(source).not.toContain("adaptEnterpriseProjectionSpec");
      expect(source).not.toContain("resolveCapabilityFreshness");
    }
    expect(dataCapabilityFeed).not.toContain(".status");
  });

  it("does not read live DataSource status when resolving access or external summaries", () => {
    const accessResolver = fs.readFileSync(
      path.join(knowledgeRoot, "sources/capability-access-resolver.ts"),
      "utf8",
    );
    const externalSummaries = fs.readFileSync(
      path.join(knowledgeRoot, "sources/external-data-sources.ts"),
      "utf8",
    );
    expect(accessResolver).not.toContain(".status");
    expect(accessResolver).not.toContain(".category");
    expect(externalSummaries).not.toContain(".status");
    expect(externalSummaries).not.toContain(".category");
    expect(externalSummaries).not.toContain("listDataSources");
  });

  it("keeps the unified knowledge runtime context within the consumption boundary", () => {
    // The single governance-aware consumption contract must expose only
    // pre-governed knowledge — never a live enterprise-data connector invoke.
    const runtimeContext = fs.readFileSync(
      path.join(knowledgeRoot, "runtime/knowledge-runtime-context.ts"),
      "utf8",
    );
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(pattern.test(runtimeContext)).toBe(false);
    }
  });
});
