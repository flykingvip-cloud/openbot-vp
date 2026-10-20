/** 网关 WebSocket 尚未 OPEN 时的瞬时 RPC 错误。 */
export function isTransientGatewayError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (isTransientGatewayErrorMessage(message)) {
    return true;
  }
  const retryable = (err as { details?: { retryable?: unknown } } | null | undefined)?.details
    ?.retryable;
  return retryable === true;
}

export function isTransientGatewayErrorMessage(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }
  return /not connected|gateway closed|temporarily rate limited/i.test(message);
}

export const GATEWAY_LOAD_RETRY_DELAYS_MS = [400, 800, 1600, 3200, 5000] as const;

export type GatewayLoadRetryController = {
  cancel: () => void;
};

/**
 * 在 Gateway 连接竞态期间按退避间隔重复调用 runLoad，直到：
 * - 调用方 cancel（通常表示加载成功），或
 * - 达到最大重试次数并触发 onExhausted。
 */
export function createGatewayLoadRetry(
  runLoad: () => void,
  options?: { onExhausted?: () => void },
): GatewayLoadRetryController {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    cancelled = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  void (async () => {
    for (const delay of GATEWAY_LOAD_RETRY_DELAYS_MS) {
      if (cancelled) {
        return;
      }
      await new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          timer = null;
          resolve();
        }, delay);
      });
      if (cancelled) {
        return;
      }
      runLoad();
    }
    if (!cancelled) {
      options?.onExhausted?.();
    }
  })();

  return { cancel };
}
