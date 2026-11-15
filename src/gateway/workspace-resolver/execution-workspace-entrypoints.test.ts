import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

const entrypoints = [
  {
    name: "Chat",
    file: "src/auto-reply/reply/get-reply.ts",
    rootAssign: "executionWorkspace.rootPath",
  },
  {
    name: "CLI agentCommand",
    file: "src/commands/agent.ts",
    rootAssign: "boundWorkspace.rootPath",
  },
  {
    name: "Cron isolated-agent",
    file: "src/cron/isolated-agent/run.ts",
    rootAssign: "boundWorkspace?.rootPath",
  },
  {
    name: "Followup queued runner",
    file: "src/auto-reply/reply/followup-runner.ts",
    rootAssign: "boundWorkspace.rootPath",
  },
] as const;

it.each(entrypoints)(
  "$name binds the canonical execution workspace and does not guess a fallback identity",
  ({ file, rootAssign }) => {
    const source = readSrc(file);
    expect(source).toContain('from "');
    expect(source).toContain("resolveExecutionWorkspace");
    expect(source).toContain(rootAssign);
    expect(source).not.toMatch(/disable(?:d)?[_-]?binding[_-]?check/i);
  },
);
