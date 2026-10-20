/**
 * supervisor/validator.ts — acceptance planning + Fabric validation (M1, Task 1.4).
 *
 * Validation adapters are registered; the first `detect()` hit plans criteria
 * (P1-4 — no if-chain). Steps run via Fabric `service.execute` in the task
 * workspace; pass/fail is assembled here — `judge` lives in engine.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { hashStdout } from "../../fabric/audit.js";
import type { ToolRequest } from "../../fabric/contract.js";
import type { FabricService } from "../../fabric/service.js";
import type {
  AcceptanceCriteria,
  SupervisedTask,
  ValidationReport,
  ValidationStepResult,
} from "./types.js";

export interface ValidationAdapter {
  detect(repoRoot: string): Promise<boolean>;
  plan(repoRoot: string): Promise<AcceptanceCriteria>;
}

const MAX_STDERR_SUMMARY = 500;

function redactStderrSummary(stderr: string | undefined): string | undefined {
  if (!stderr?.trim()) {
    return undefined;
  }
  const trimmed = stderr
    .trim()
    .replace(/\b(sk-[a-zA-Z0-9_-]{10,}|ghp_[a-zA-Z0-9]{20,})\b/g, "[redacted]");
  return trimmed.length > MAX_STDERR_SUMMARY ? `${trimmed.slice(0, MAX_STDERR_SUMMARY)}…` : trimmed;
}

/** Node repo: package.json scripts → test/lint/build steps (D-VAL-NODE). */
export class NodeValidationAdapter implements ValidationAdapter {
  async detect(repoRoot: string): Promise<boolean> {
    try {
      await fs.access(path.join(repoRoot, "package.json"));
      return true;
    } catch {
      return false;
    }
  }

  async plan(repoRoot: string): Promise<AcceptanceCriteria> {
    const raw = await fs.readFile(path.join(repoRoot, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    const steps: AcceptanceCriteria["steps"] = [];
    if (scripts.test) {
      steps.push({ id: "test", argv: ["npm", "test"], required: true });
    }
    if (scripts.lint) {
      steps.push({ id: "lint", argv: ["npm", "run", "lint"], required: true });
    }
    if (scripts.build) {
      steps.push({ id: "build", argv: ["npm", "run", "build"], required: true });
    }
    return { steps, source: "repo-detected" };
  }
}

export class ValidationAdapterRegistry {
  private readonly adapters: ValidationAdapter[];

  constructor(adapters: ValidationAdapter[] = [new NodeValidationAdapter()]) {
    this.adapters = adapters;
  }

  async planForRepo(repoRoot: string): Promise<AcceptanceCriteria | null> {
    for (const adapter of this.adapters) {
      if (await adapter.detect(repoRoot)) {
        return adapter.plan(repoRoot);
      }
    }
    return null;
  }
}

export interface ValidatorPort {
  validate(input: {
    task: SupervisedTask;
    criteria: AcceptanceCriteria;
  }): Promise<ValidationReport>;
}

function buildStepRequest(task: SupervisedTask, stepId: string, argv: string[]): ToolRequest {
  return {
    id: `sup-val-${task.taskId}-${stepId}`,
    source: {
      type: "openbot",
      tenantId: task.tenantId,
      userId: task.userId,
    },
    tool: { name: "shell" },
    input: { args: argv, cwd: task.workspace.root },
    context: { repoRoot: task.workspace.root },
    trace: {
      sessionId: task.taskId,
      correlationId: task.taskId,
      taskId: task.taskId,
    },
  };
}

function stepOk(
  step: AcceptanceCriteria["steps"][number],
  status: string,
  exitCode: number | null | undefined,
): boolean {
  if (status === "denied") {
    return false;
  }
  const expected = step.expect?.exitCode ?? 0;
  return status === "success" && exitCode === expected;
}

export function createFabricValidatorPort(getService: () => FabricService | null): ValidatorPort {
  return {
    async validate({ task, criteria }) {
      const service = getService();
      if (!service) {
        throw new Error("Fabric service unavailable (validator requires Fabric)");
      }
      const required = criteria.steps.filter((s) => s.required);
      if (criteria.steps.length === 0 || required.length === 0) {
        // Fail-safe: we can not mechanically verify completion → never claim passed.
        return {
          steps: [],
          passed: false,
          at: new Date().toISOString(),
        } satisfies ValidationReport;
      }
      const steps: ValidationStepResult[] = [];
      let passed = true;
      for (const step of criteria.steps) {
        const started = Date.now();
        const { result } = await service.execute(buildStepRequest(task, step.id, step.argv));
        const denied = result.status === "denied";
        const exitCode = result.exitCode ?? null;
        const ok = !denied && stepOk(step, result.status, exitCode);
        if (step.required && !ok) {
          passed = false;
        }
        steps.push({
          id: step.id,
          argv: step.argv,
          exitCode,
          ok,
          stdoutHash: hashStdout(result.output?.stdout),
          stderrSummary: redactStderrSummary(result.output?.stderr),
          durationMs: result.timing.end - result.timing.start || Date.now() - started,
          denied,
        });
      }
      return { steps, passed, at: new Date().toISOString() };
    },
  };
}
