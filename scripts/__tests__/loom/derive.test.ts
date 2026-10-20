import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CODEOWNERS_FILE,
  deriveAgentsBlock,
  deriveAgentsBySpec,
  deriveCodeowners,
  handleResolver,
  loadCodeownersConfig,
  toCodeownersPattern,
} from "../../loom/derive.js";
import { type Registry, validateRegistry } from "../../loom/registry.js";

function registry(): Registry {
  return validateRegistry({
    version: 1,
    tasks: [
      {
        id: "auth-refactor:kiro-auth",
        owner: "kiro-auth",
        paths: ["src/auth/**", "src/session/**"],
        since: "2026-06-12",
        metadata: { spec: "auth-refactor" },
      },
      { id: "no-paths:ghost", owner: "ghost", paths: [], metadata: { spec: "ghost-spec" } },
    ],
    landingStreams: [],
  });
}

describe("loom/derive — deriveAgentsBlock", () => {
  it("renders a `## Agents` block with one row per path-bearing task", () => {
    const block = deriveAgentsBlock(registry());
    expect(block).toContain("## Agents");
    expect(block).toContain(
      "- kiro-auth · role: owner · scope: auth-refactor · paths: src/auth/**, src/session/** · since: 2026-06-12",
    );
  });

  it("skips tasks with no paths (cannot be attributed)", () => {
    expect(deriveAgentsBlock(registry())).not.toContain("ghost");
  });
});

describe("loom/derive — deriveAgentsBySpec", () => {
  it("groups rows by spec", () => {
    const bySpec = deriveAgentsBySpec(registry());
    expect([...bySpec.keys()]).toEqual(["auth-refactor"]);
    expect(bySpec.get("auth-refactor")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CODEOWNERS derivation (engineering-governance R11)
// ─────────────────────────────────────────────────────────────────────────────

function codeownersRegistry(): Registry {
  return validateRegistry({
    version: 1,
    tasks: [
      {
        id: "billing:alice-agent",
        owner: "alice-agent",
        paths: ["src/billing/**", "docs/billing.md"],
        state: "active",
        metadata: { spec: "billing" },
      },
      {
        id: "web:bob-agent",
        owner: "bob-agent",
        paths: ["app/web/"],
        state: "active",
        metadata: { spec: "web" },
      },
      {
        id: "closed:carol-agent",
        owner: "carol-agent",
        paths: ["src/legacy/**"],
        state: "landed",
        metadata: { spec: "closed" },
      },
      { id: "no-paths:dave-agent", owner: "dave-agent", paths: [], state: "active" },
    ],
    landingStreams: [],
  });
}

const allHandles = () => "@octocat";

describe("loom/derive — toCodeownersPattern", () => {
  it("anchors a relative glob at the repo root", () => {
    expect(toCodeownersPattern("src/billing/**")).toEqual({ pattern: "/src/billing/**" });
  });

  it("leaves an already-anchored pattern alone", () => {
    expect(toCodeownersPattern("/src/a.ts")).toEqual({ pattern: "/src/a.ts" });
  });

  it("rejects a sub-symbol claim, because '#' starts a CODEOWNERS comment", () => {
    const result = toCodeownersPattern("ui/src/home-page-contracts.ts#homeFocus");
    expect(result).toHaveProperty("reason");
    expect((result as { reason: string }).reason).toContain("#");
  });

  it("rejects a pattern containing whitespace (CODEOWNERS splits on spaces)", () => {
    expect(toCodeownersPattern("src/two words.ts")).toHaveProperty("reason");
  });

  it("rejects an empty pattern", () => {
    expect(toCodeownersPattern("   ")).toHaveProperty("reason");
  });
});

describe("loom/derive — deriveCodeowners", () => {
  it("emits one anchored rule per path, with the agent id as a trailing comment", () => {
    const { content } = deriveCodeowners(codeownersRegistry(), { handleFor: allHandles });
    expect(content).toContain("/src/billing/** @octocat");
    expect(content).toContain("/docs/billing.md @octocat");
    expect(content).toContain("/app/web/ @octocat");
    expect(content).toContain("# alice-agent — billing (task: billing:alice-agent");
  });

  it("marks the file as generated and names the source of truth", () => {
    const { content } = deriveCodeowners(codeownersRegistry(), { handleFor: allHandles });
    expect(content).toContain("GENERATED FILE");
    expect(content).toContain(".loom/registry.yaml");
    expect(content).toContain("loom derive --codeowners --write");
  });

  // The header has to say this out loud: a single-human repo cannot enforce
  // code-owner review, so treating this file as a gate would be a false sense of
  // safety (R11.3).
  it("states that it is a signal rather than a merge gate", () => {
    const { content } = deriveCodeowners(codeownersRegistry(), { handleFor: allHandles });
    expect(content).toContain("NOT a merge");
    expect(content).toContain("ownership-overlap");
  });

  it("omits terminal-state tasks, which no longer claim paths", () => {
    const { content } = deriveCodeowners(codeownersRegistry(), { handleFor: allHandles });
    expect(content).not.toContain("/src/legacy/**");
    expect(content).not.toContain("carol-agent");
  });

  it("omits tasks with no paths", () => {
    const { content } = deriveCodeowners(codeownersRegistry(), { handleFor: allHandles });
    expect(content).not.toContain("dave-agent");
  });

  // Registry owners are agent ids, not GitHub accounts. Emitting `@alice-agent`
  // yields an unknown owner that silently voids the file, so unmapped agents are
  // reported and the caller refuses to write.
  it("reports unmapped agents instead of inventing handles", () => {
    const result = deriveCodeowners(codeownersRegistry(), {
      handleFor: (agent) => (agent === "alice-agent" ? "@octocat" : undefined),
    });
    expect(result.unmapped).toEqual(["bob-agent"]);
    expect(result.content).toContain("/src/billing/**");
    expect(result.content).not.toContain("bob-agent");
  });

  it("reports paths it could not express, without dropping the rest of the task", () => {
    const registry = validateRegistry({
      version: 1,
      tasks: [
        {
          id: "t:a",
          owner: "a",
          paths: ["src/ok.ts", "src/bad.ts#symbol"],
          state: "active",
        },
      ],
      landingStreams: [],
    });
    const result = deriveCodeowners(registry, { handleFor: allHandles });
    expect(result.skipped).toEqual([
      { path: "src/bad.ts#symbol", reason: expect.stringContaining("#") },
    ]);
    expect(result.content).toContain("/src/ok.ts @octocat");
  });

  it("is deterministic for the same registry (so drift checks are meaningful)", () => {
    const a = deriveCodeowners(codeownersRegistry(), { handleFor: allHandles }).content;
    const b = deriveCodeowners(codeownersRegistry(), { handleFor: allHandles }).content;
    expect(a).toBe(b);
  });

  it("ends with a trailing newline", () => {
    const { content } = deriveCodeowners(codeownersRegistry(), { handleFor: allHandles });
    expect(content.endsWith("\n")).toBe(true);
  });
});

describe("loom/derive — loadCodeownersConfig + handleResolver", () => {
  function withConfig<T>(yaml: string | null, run: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), "loom-codeowners-"));
    try {
      if (yaml !== null) {
        mkdirSync(join(dir, ".loom"), { recursive: true });
        writeFileSync(join(dir, ".loom", "config.yaml"), yaml);
      }
      return run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("defaults to .github/CODEOWNERS with no handles when no config exists", () => {
    withConfig(null, (dir) => {
      const config = loadCodeownersConfig(dir);
      expect(config.path).toBe(CODEOWNERS_FILE);
      expect(config.handles).toEqual({});
      expect(config.defaultHandle).toBeUndefined();
    });
  });

  it("reads path, defaultHandle, and per-agent handles", () => {
    withConfig(
      'codeowners:\n  path: .github/OWNERS\n  defaultHandle: "@team"\n  handles:\n    kiro-loom: "@alice"\n',
      (dir) => {
        const config = loadCodeownersConfig(dir);
        expect(config.path).toBe(".github/OWNERS");
        expect(config.defaultHandle).toBe("@team");
        const resolve = handleResolver(config);
        expect(resolve("kiro-loom")).toBe("@alice");
        expect(resolve("anyone-else")).toBe("@team");
      },
    );
  });

  it("resolves to undefined when neither a mapping nor a default exists", () => {
    withConfig("codeowners:\n  handles: {}\n", (dir) => {
      expect(handleResolver(loadCodeownersConfig(dir))("ghost")).toBeUndefined();
    });
  });

  it("ignores a malformed config instead of throwing", () => {
    withConfig("codeowners: [not, an, object]\n", (dir) => {
      expect(loadCodeownersConfig(dir).path).toBe(CODEOWNERS_FILE);
    });
  });

  it("does not disturb the provisioning section it shares the file with", () => {
    withConfig(
      'provisioning:\n  defaultBase: trunk\ncodeowners:\n  defaultHandle: "@team"\n',
      (dir) => {
        expect(loadCodeownersConfig(dir).defaultHandle).toBe("@team");
      },
    );
  });
});
