/**
 * Explicit production-execution-mode flag for Path B isolation.
 *
 * Production execution mode is enabled only when
 * `OPENBOT_PRODUCTION_EXECUTION_MODE` is set to the exact value `production`.
 * `NODE_ENV=production` (or any other implicit default) is not sufficient and
 * must not be treated as a signed-off production execution setting.
 */

export const PRODUCTION_EXECUTION_MODE_ENV = "OPENBOT_PRODUCTION_EXECUTION_MODE";
export const PRODUCTION_EXECUTION_MODE_VALUE = "production";

/** Design-choice error code from the 1+3 execution protocol for an unreachable exec backend. */
export const PRODUCTION_HOST_FALLBACK_FORBIDDEN_CODE = "EXEC_UNREACHABLE";

export type ProductionExecutionModeProbe = {
  env?: NodeJS.ProcessEnv;
  /**
   * Explicit override used by tests and callers that already resolved the flag.
   * When omitted, the env value is read. This override is never inferred from
   * `NODE_ENV`.
   */
  productionExecutionMode?: boolean;
};

export function isProductionExecutionModeEnabled(
  probe: ProductionExecutionModeProbe = {},
): boolean {
  if (typeof probe.productionExecutionMode === "boolean") {
    return probe.productionExecutionMode;
  }
  const env = probe.env ?? process.env;
  return env[PRODUCTION_EXECUTION_MODE_ENV]?.trim() === PRODUCTION_EXECUTION_MODE_VALUE;
}

export function formatProductionHostFallbackForbiddenMessage(reason: string): string {
  const detail =
    reason.trim() || "Docker CLI, engine socket, or B exec service is missing or unreachable";
  return (
    `云电脑没有启动：生产执行模式已启用（${PRODUCTION_EXECUTION_MODE_ENV}=${PRODUCTION_EXECUTION_MODE_VALUE}），` +
    "Docker CLI、引擎套接字或 B 执行服务缺失或不可达，禁止回落到网关宿主执行" +
    `（${PRODUCTION_HOST_FALLBACK_FORBIDDEN_CODE}）。失败原因：${detail}`
  );
}

export const EXEC_SERVICE_UNREACHABLE_CODE = "EXEC_SERVICE_UNREACHABLE";

/**
 * The B execution service is missing or cannot be reached.
 * Production execution mode must surface this as EXEC_UNREACHABLE and
 * must not fall back to the gateway host. This class is the classifier
 * hook only; it does not implement the later execution protocol.
 */
export class ExecServiceUnreachableError extends Error {
  readonly code = EXEC_SERVICE_UNREACHABLE_CODE;

  constructor(
    detail = "B exec service is unreachable (connection refused to the Path B execution endpoint)",
  ) {
    super(detail);
    this.name = "ExecServiceUnreachableError";
  }
}

export function isExecServiceUnreachableError(error: unknown): boolean {
  if (error instanceof ExecServiceUnreachableError) {
    return true;
  }
  const record =
    error && typeof error === "object" ? (error as { code?: unknown; name?: unknown }) : null;
  if (record?.name === "ExecServiceUnreachableError") {
    return true;
  }
  return record?.code === EXEC_SERVICE_UNREACHABLE_CODE;
}
