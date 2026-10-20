/**
 * Shared loader for 「能力应用管理」controllers.
 *
 * 背景：进入页面时网关连接可能尚未 OPEN，`client.request` 会以
 * "gateway not connected" 立即拒绝；若直接置为错误态，用户首屏就会看到
 * "加载失败，请重试"，但其实只是连接竞态。此处对这类瞬时错误做有限次自动
 * 重试，并统一区分超时与业务错误，同时把真实错误打到 console 便于诊断。
 */

const TIMEOUT_MS = 10000;
const MAX_ATTEMPTS = 5;

export class RpcTimeoutError extends Error {
  constructor() {
    super("TIMEOUT");
    this.name = "RpcTimeoutError";
  }
}

/** 仅对"网关未连接/连接关闭"这类瞬时传输错误重试。 */
function isTransientGatewayError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not connected|gateway closed/i.test(message);
}

export type LoadWithRetryOptions = {
  /** 日志前缀，用于诊断（例如 RPC 方法名）。 */
  label: string;
  /** 取消信号：若期间触发了新的加载，应中止本次过期结果的写入。 */
  signal?: { aborted: boolean };
};

/**
 * 执行一次带超时 + 瞬时错误重试的 RPC 调用。
 *
 * - 成功：返回结果。
 * - 取消（signal.aborted）：返回 `undefined`，调用方应直接丢弃。
 * - 失败：抛出 `RpcTimeoutError`（超时）或原始错误（业务/不可重试）。
 */
export async function loadWithRetry<T>(
  call: () => Promise<T>,
  options: LoadWithRetryOptions,
): Promise<T | undefined> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await Promise.race<T>([
        call(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new RpcTimeoutError()), TIMEOUT_MS),
        ),
      ]);
      if (options.signal?.aborted) {
        return undefined;
      }
      return result;
    } catch (err) {
      lastError = err;
      if (options.signal?.aborted) {
        return undefined;
      }
      if (!isTransientGatewayError(err) || attempt === MAX_ATTEMPTS - 1) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      if (options.signal?.aborted) {
        return undefined;
      }
    }
  }

  console.error(`[enterprise-usage] ${options.label} failed:`, lastError);
  if (lastError instanceof RpcTimeoutError) {
    throw lastError;
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** 把加载错误转成业务语言文案。 */
export function describeLoadError(err: unknown): string {
  return err instanceof RpcTimeoutError ? "数据加载超时，请重试" : "加载失败，请重试";
}
