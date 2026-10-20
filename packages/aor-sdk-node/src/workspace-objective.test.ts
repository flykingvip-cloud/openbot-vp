import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectPackageManager, resolveWorkspaceObjectiveCommands } from "./workspace-objective.js";

function tempWorkspace(name: string, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content, "utf8");
  }
  return dir;
}

describe("resolveWorkspaceObjectiveCommands", () => {
  it("maps package.json scripts via pnpm when pnpm-lock.yaml exists", () => {
    const dir = tempWorkspace("aor-ws-pnpm-", {
      "pnpm-lock.yaml": "",
      "package.json": JSON.stringify({
        scripts: { build: "tsc", test: "vitest run", "test:coverage": "vitest run --coverage" },
      }),
    });
    try {
      expect(detectPackageManager(dir)).toBe("pnpm");
      const cmds = resolveWorkspaceObjectiveCommands(dir);
      expect(cmds.build).toEqual({ command: "pnpm", args: ["build"] });
      expect(cmds.test).toEqual({ command: "pnpm", args: ["test"] });
      expect(cmds.coverage).toEqual({ command: "pnpm", args: ["test:coverage"] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("maps scripts via npm run when package-lock.json exists", () => {
    const dir = tempWorkspace("aor-ws-npm-", {
      "package-lock.json": "{}",
      "package.json": JSON.stringify({ scripts: { test: "node test.js" } }),
    });
    try {
      const cmds = resolveWorkspaceObjectiveCommands(dir);
      expect(cmds.test).toEqual({ command: "npm", args: ["run", "test"] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when workspace has no objective scripts", () => {
    const dir = tempWorkspace("aor-ws-empty-", {
      "package.json": JSON.stringify({ name: "empty" }),
    });
    try {
      expect(() => resolveWorkspaceObjectiveCommands(dir)).toThrow(/no build\/test\/coverage/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
