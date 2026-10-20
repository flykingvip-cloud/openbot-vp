/**
 * Supervisor task creation service — shared by gateway RPC and daibai catalog delegate.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import { withTimeout } from "../../utils/with-timeout.js";
import { buildTaskBudget } from "./budget.js";
import { assertSupervisorTenantCommercialCapacity } from "./commercial-run-gate.js";
import { tickSupervisedTask } from "./driver.js";
import type { SupervisorPorts } from "./engine.js";
import { assertExecutionChainReady, ExecutionChainGateError } from "./execution-chain-gate.js";
import { isSupervisorEnabled } from "./feature.js";
import { createTask } from "./store.js";
import {
  SUPERVISOR_REPO_AUTO_TEMPLATE_ID,
  getSupervisorTaskTemplate,
  parseAcceptanceCriteriaInput,
} from "./templates.js";
import type { AcceptanceCriteria, SupervisedTask } from "./types.js";
import { ValidationAdapterRegistry } from "./validator.js";

const WORKSPACE_ENSURE_TIMEOUT_MS = 120_000;

export class SupervisorTaskCreateError extends Error {
  readonly code: "UNAVAILABLE" | "INVALID_REQUEST";

  constructor(message: string, code: "UNAVAILABLE" | "INVALID_REQUEST" = "INVALID_REQUEST") {
    super(message);
    this.name = "SupervisorTaskCreateError";
    this.code = code;
  }
}

export type CreateSupervisedTaskInput = {
  goal: string;
  repoRoot: string;
  workerBackendId: string;
  workerModel?: string;
  taskId?: string;
  tenantId?: string;
  userId?: string;
  seatId?: string;
  agentId?: string;
  templateId?: string;
  acceptance?: unknown;
};

function parseWorkerRef(input: CreateSupervisedTaskInput): { backendId: string; model?: string } {
  const backendId = input.workerBackendId.trim();
  const model = input.workerModel?.trim() || undefined;
  if (!backendId) {
    throw new SupervisorTaskCreateError("missing workerBackendId");
  }
  return { backendId, model };
}

function assertAcceptance(acceptance: AcceptanceCriteria | null): AcceptanceCriteria {
  if (!acceptance || acceptance.steps.length === 0) {
    throw new SupervisorTaskCreateError(
      "no machine-checkable acceptance criteria found (repo lacks package.json scripts test/lint/build)",
    );
  }
  const requiredCount = acceptance.steps.filter((step) => step.required).length;
  if (requiredCount === 0) {
    throw new SupervisorTaskCreateError(
      "acceptance criteria has no required machine-checkable steps",
    );
  }
  return acceptance;
}

async function resolveAcceptanceForCreate(
  input: CreateSupervisedTaskInput,
  repoRoot: string,
): Promise<AcceptanceCriteria> {
  const explicit = parseAcceptanceCriteriaInput(input.acceptance);
  if (input.acceptance !== undefined && !explicit) {
    throw new SupervisorTaskCreateError("invalid acceptance criteria");
  }
  if (explicit) {
    return assertAcceptance(explicit);
  }

  const templateId = input.templateId?.trim() || SUPERVISOR_REPO_AUTO_TEMPLATE_ID;
  if (templateId !== SUPERVISOR_REPO_AUTO_TEMPLATE_ID) {
    const template = getSupervisorTaskTemplate(templateId);
    if (!template) {
      throw new SupervisorTaskCreateError(`unknown templateId: ${templateId}`);
    }
    return assertAcceptance(template.acceptance);
  }

  try {
    const planned = await new ValidationAdapterRegistry().planForRepo(repoRoot);
    if (!planned) {
      throw new SupervisorTaskCreateError(
        "no machine-checkable acceptance criteria found (repo lacks package.json scripts test/lint/build)",
      );
    }
    return assertAcceptance(planned);
  } catch (err) {
    if (err instanceof SupervisorTaskCreateError) {
      throw err;
    }
    throw new SupervisorTaskCreateError(
      `acceptance plan failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function createSupervisedTask(
  input: CreateSupervisedTaskInput,
  deps: { ports: SupervisorPorts },
): Promise<SupervisedTask> {
  if (!isSupervisorEnabled()) {
    throw new SupervisorTaskCreateError("supervisor is not enabled", "UNAVAILABLE");
  }

  const goal = input.goal.trim();
  const repoRoot = input.repoRoot.trim();
  if (!goal) {
    throw new SupervisorTaskCreateError("missing goal");
  }
  if (!repoRoot) {
    throw new SupervisorTaskCreateError("missing repoRoot");
  }

  const workerRef = parseWorkerRef(input);
  const taskId = input.taskId?.trim() || `sup_${crypto.randomUUID()}`;

  const cfg = loadConfig();
  try {
    await assertExecutionChainReady({
      workerBackendId: workerRef.backendId,
      ...(workerRef.model ? { model: workerRef.model } : {}),
      ...(input.tenantId?.trim() ? { tenantId: input.tenantId.trim() } : {}),
      ...(input.seatId?.trim() ? { seatId: input.seatId.trim() } : {}),
      ...(input.userId?.trim() ? { userId: input.userId.trim() } : {}),
      cfg,
      ...(deps.ports.nodeAgentRegistry ? { nodeAgentRegistry: deps.ports.nodeAgentRegistry } : {}),
      ...(deps.ports.nodeInvoke ? { nodeInvoke: deps.ports.nodeInvoke } : {}),
    });
  } catch (err) {
    if (err instanceof ExecutionChainGateError) {
      throw new SupervisorTaskCreateError(err.message, err.code);
    }
    throw err;
  }

  const acceptance = await resolveAcceptanceForCreate(input, repoRoot);

  if (input.tenantId?.trim()) {
    try {
      await assertSupervisorTenantCommercialCapacity(input.tenantId.trim());
    } catch (err) {
      throw new SupervisorTaskCreateError(err instanceof Error ? err.message : String(err));
    }
  }

  try {
    await fs.access(path.join(repoRoot, ".git"));
  } catch {
    throw new SupervisorTaskCreateError("repoRoot must be a git repository (.git not found)");
  }

  let workspace: SupervisedTask["workspace"];
  try {
    workspace = await withTimeout(
      deps.ports.workspace.ensure({
        taskId,
        agentId: input.agentId?.trim() || undefined,
        repoRoot,
      }),
      WORKSPACE_ENSURE_TIMEOUT_MS,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SupervisorTaskCreateError(
      message === "timeout"
        ? `workspace provisioning timed out after ${Math.round(WORKSPACE_ENSURE_TIMEOUT_MS / 1000)}s`
        : `workspace provisioning failed: ${message}`,
      "UNAVAILABLE",
    );
  }

  const budget = buildTaskBudget({ cfg, tenantId: input.tenantId?.trim() || undefined });
  const now = new Date().toISOString();
  const task: SupervisedTask = {
    taskId,
    goal,
    repoRoot,
    tenantId: input.tenantId?.trim() || undefined,
    userId: input.userId?.trim() || undefined,
    seatId: input.seatId?.trim() || undefined,
    agentId: input.agentId?.trim() || undefined,
    worker: { backendId: workerRef.backendId, model: workerRef.model },
    workspace,
    acceptance,
    state: "planned",
    iterations: [],
    budget,
    createdAt: now,
    updatedAt: now,
  };

  const created = await createTask(task).catch((err) => {
    throw new SupervisorTaskCreateError(err instanceof Error ? err.message : String(err));
  });

  void tickSupervisedTask(created.taskId, deps.ports, {}).catch(() => undefined);
  return created;
}
