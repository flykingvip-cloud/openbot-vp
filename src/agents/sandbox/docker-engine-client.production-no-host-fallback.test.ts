import { describe, expect, it, vi } from "vitest";
import {
  decideAccountWorkerDockerFailure,
  DockerCliMissingError,
  DockerEngineUnreachableError,
  formatDockerCliMissingUserMessage,
  type AccountWorkerDockerFailureDecision,
} from "./docker-engine-client.js";
import {
  formatProductionHostFallbackForbiddenMessage,
  isProductionExecutionModeEnabled,
  PRODUCTION_EXECUTION_MODE_ENV,
  PRODUCTION_EXECUTION_MODE_VALUE,
  PRODUCTION_HOST_FALLBACK_FORBIDDEN_CODE,
} from "./production-execution-mode.js";

/**
 * Mirrors `context.ts` dispatch without editing that file: `action: "host"`
 * continues the turn on the gateway host; `visible-error` throws the failure
 * and must not run a host command.
 */
function dispatchLikeSandboxContext(
  decision: AccountWorkerDockerFailureDecision,
  hostExec: () => void,
): { status: "completed" | "failed" | "raised"; executedOnHost: boolean; reason?: string } {
  if (decision.action === "raise") {
    return { status: "raised", executedOnHost: false };
  }
  if (decision.action === "host") {
    hostExec();
    // Legacy path keeps the turn alive on the gateway host.
    return { status: "completed", executedOnHost: true, reason: decision.failure };
  }
  return { status: "failed", executedOnHost: false, reason: decision.failure };
}

const missingCli = new DockerCliMissingError();
const socketRefused = new DockerEngineUnreachableError(
  "/var/run/docker.sock",
  "ECONNREFUSED: connect ECONNREFUSED",
);
const execServiceUnreachable = new Error(
  "B exec service is unreachable (connection refused to the Path B execution endpoint)",
);

describe("isProductionExecutionModeEnabled", () => {
  it("enables only the explicit OPENBOT_PRODUCTION_EXECUTION_MODE=production value", () => {
    expect(isProductionExecutionModeEnabled({ env: {} })).toBe(false);
    expect(
      isProductionExecutionModeEnabled({
        env: { [PRODUCTION_EXECUTION_MODE_ENV]: PRODUCTION_EXECUTION_MODE_VALUE },
      }),
    ).toBe(true);
    expect(
      isProductionExecutionModeEnabled({
        env: { [PRODUCTION_EXECUTION_MODE_ENV]: `  ${PRODUCTION_EXECUTION_MODE_VALUE}  ` },
      }),
    ).toBe(true);
  });

  it("does not infer production execution mode from NODE_ENV or undocumented values", () => {
    expect(
      isProductionExecutionModeEnabled({
        env: { NODE_ENV: "production" },
      }),
    ).toBe(false);
    expect(
      isProductionExecutionModeEnabled({
        env: { NODE_ENV: "production", [PRODUCTION_EXECUTION_MODE_ENV]: "1" },
      }),
    ).toBe(false);
    expect(
      isProductionExecutionModeEnabled({
        env: { NODE_ENV: "production", [PRODUCTION_EXECUTION_MODE_ENV]: "true" },
      }),
    ).toBe(false);
    expect(
      isProductionExecutionModeEnabled({
        env: { NODE_ENV: "production", [PRODUCTION_EXECUTION_MODE_ENV]: "prod" },
      }),
    ).toBe(false);
    expect(
      isProductionExecutionModeEnabled({
        env: { NODE_ENV: "production", [PRODUCTION_EXECUTION_MODE_ENV]: "Production" },
      }),
    ).toBe(false);
    expect(
      isProductionExecutionModeEnabled({
        env: { NODE_ENV: "production", [PRODUCTION_EXECUTION_MODE_ENV]: "" },
      }),
    ).toBe(false);
  });
});

describe("decideAccountWorkerDockerFailure production host-fallback gate", () => {
  it("legacy single-host path: a missing Docker CLI still falls back to the gateway host", () => {
    const hostExec = vi.fn();
    const decision = decideAccountWorkerDockerFailure(missingCli, {
      env: { NODE_ENV: "production" },
    });
    expect(decision.action).toBe("host");
    if (decision.action === "host") {
      expect(decision.failure).toBe(formatDockerCliMissingUserMessage());
      expect(decision.failure).toContain("DOCKER_CLI_MISSING");
    }

    const taskId = "task-legacy-missing-cli";
    const result = dispatchLikeSandboxContext(decision, hostExec);
    expect(result.executedOnHost).toBe(true);
    expect(hostExec).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("completed");
    expect(result.reason).toContain("DOCKER_CLI_MISSING");
    expect(taskId).toBe("task-legacy-missing-cli");
  });

  it("production execution mode: the same missing Docker CLI scenario fails clearly and does not run a host command", () => {
    const hostExec = vi.fn();
    const decision = decideAccountWorkerDockerFailure(missingCli, {
      env: {
        NODE_ENV: "development",
        [PRODUCTION_EXECUTION_MODE_ENV]: PRODUCTION_EXECUTION_MODE_VALUE,
      },
    });
    expect(decision.action).toBe("visible-error");
    if (decision.action === "visible-error") {
      expect(decision.failure).toContain(PRODUCTION_HOST_FALLBACK_FORBIDDEN_CODE);
      expect(decision.failure).toContain(
        `${PRODUCTION_EXECUTION_MODE_ENV}=${PRODUCTION_EXECUTION_MODE_VALUE}`,
      );
      expect(decision.failure).toContain("DOCKER_CLI_MISSING");
      expect(decision.failure).toContain(formatDockerCliMissingUserMessage());
      expect(decision.failure).toBe(
        formatProductionHostFallbackForbiddenMessage(formatDockerCliMissingUserMessage()),
      );
    }

    const task = { id: "task-prod-missing-cli", status: "running", reason: "" };
    const result = dispatchLikeSandboxContext(decision, hostExec);
    expect(result.executedOnHost).toBe(false);
    expect(hostExec).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.status).not.toBe("completed");
    expect(result.reason).toContain(PRODUCTION_HOST_FALLBACK_FORBIDDEN_CODE);
    expect(task.id).toBe("task-prod-missing-cli");
    task.status = result.status;
    task.reason = result.reason ?? "";
    expect(task.status).toBe("failed");
    expect(task.status).not.toBe("completed");
    expect(task.id).toBe("task-prod-missing-cli");
    expect(task.reason).toContain("DOCKER_CLI_MISSING");
  });

  it("keeps socket-refused handling off the gateway host when production mode is off", () => {
    const hostExec = vi.fn();
    const decision = decideAccountWorkerDockerFailure(socketRefused, { env: {} });
    expect(decision.action).toBe("visible-error");
    if (decision.action === "visible-error") {
      expect(decision.failure).toContain("cannot connect to the docker daemon");
      expect(decision.failure).toContain("ECONNREFUSED");
      expect(decision.failure).not.toContain("DOCKER_CLI_MISSING");
    }
    const result = dispatchLikeSandboxContext(decision, hostExec);
    expect(result.executedOnHost).toBe(false);
    expect(hostExec).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
  });

  it("does not regress socket-refused handling when production execution mode is on", () => {
    const hostExec = vi.fn();
    const decision = decideAccountWorkerDockerFailure(socketRefused, {
      env: { [PRODUCTION_EXECUTION_MODE_ENV]: PRODUCTION_EXECUTION_MODE_VALUE },
    });
    expect(decision.action).toBe("visible-error");
    if (decision.action === "visible-error") {
      expect(decision.failure).toContain("cannot connect to the docker daemon");
      expect(decision.failure).toContain("/var/run/docker.sock");
      expect(decision.failure).toContain("ECONNREFUSED");
      expect(decision.failure).not.toContain("DOCKER_CLI_MISSING");
    }
    const result = dispatchLikeSandboxContext(decision, hostExec);
    expect(result.executedOnHost).toBe(false);
    expect(hostExec).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.status).not.toBe("completed");
  });

  it("does not treat a docker.sock ENOENT as host fallback in either mode", () => {
    const error = Object.assign(new Error("connect ENOENT /var/run/docker.sock"), {
      code: "ENOENT",
    });
    expect(decideAccountWorkerDockerFailure(error, { env: {} }).action).not.toBe("host");
    expect(
      decideAccountWorkerDockerFailure(error, {
        env: { [PRODUCTION_EXECUTION_MODE_ENV]: PRODUCTION_EXECUTION_MODE_VALUE },
      }).action,
    ).not.toBe("host");
  });

  it("does not run a host command when the B exec service is unreachable", () => {
    const hostExec = vi.fn();
    const legacy = decideAccountWorkerDockerFailure(execServiceUnreachable, { env: {} });
    const production = decideAccountWorkerDockerFailure(execServiceUnreachable, {
      env: { [PRODUCTION_EXECUTION_MODE_ENV]: PRODUCTION_EXECUTION_MODE_VALUE },
    });
    expect(legacy.action).not.toBe("host");
    expect(production.action).not.toBe("host");
    expect(dispatchLikeSandboxContext(legacy, hostExec).executedOnHost).toBe(false);
    expect(dispatchLikeSandboxContext(production, hostExec).executedOnHost).toBe(false);
    expect(hostExec).not.toHaveBeenCalled();
  });

  it("still raises non-docker failures instead of marking them complete on the host", () => {
    const hostExec = vi.fn();
    const decision = decideAccountWorkerDockerFailure(new Error("runtime lease is revoked"), {
      env: { [PRODUCTION_EXECUTION_MODE_ENV]: PRODUCTION_EXECUTION_MODE_VALUE },
    });
    expect(decision.action).toBe("raise");
    const result = dispatchLikeSandboxContext(decision, hostExec);
    expect(result.status).toBe("raised");
    expect(result.executedOnHost).toBe(false);
    expect(hostExec).not.toHaveBeenCalled();
  });
});
