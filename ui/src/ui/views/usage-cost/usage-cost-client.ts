import type {
  UsageCostLayerView,
  UsageCostSurface,
} from "../../../../../src/shared/usage-cost-layer.ts";

export type UsageCostClient = {
  request: (method: string, params?: unknown) => Promise<unknown>;
};

export type UsageCostSlot = {
  status: "idle" | "loading" | "ready" | "error";
  view: UsageCostLayerView | null;
  error: string | null;
};

const slots = new Map<string, UsageCostSlot>();

export function usageCostSlotKey(input: {
  surface: UsageCostSurface;
  taskId?: string | null;
  tenantId?: string | null;
}): string {
  return `${input.surface}:${input.tenantId?.trim() ?? ""}:${input.taskId?.trim() ?? ""}`;
}

export function readUsageCostSlot(key: string): UsageCostSlot {
  return slots.get(key) ?? { status: "idle", view: null, error: null };
}

export function __resetUsageCostSlotsForTest(): void {
  slots.clear();
}

export function __seedUsageCostSlotForTest(key: string, slot: UsageCostSlot): void {
  slots.set(key, slot);
}

const SAFE_ERROR =
  /^(无权查看该任务|无权查看平台成本|无权查看企业汇总|无法确定身份|参数不正确|时间范围不正确|用量暂时无法读取，请稍后重试)$/;

export function publicUsageCostError(error: unknown): string {
  const message = errorMessage(error);
  return SAFE_ERROR.test(message) ? message : "用量暂时无法读取，请稍后重试";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim();
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message.trim() : "";
  }
  return "";
}

function isUsageCostView(value: unknown): value is UsageCostLayerView {
  if (!value || typeof value !== "object") {
    return false;
  }
  const view = value as Partial<UsageCostLayerView>;
  return (
    view.schemaVersion === 1 &&
    (view.surface === "user" || view.surface === "enterprise" || view.surface === "platform")
  );
}

export async function ensureUsageCostLayer(input: {
  client?: UsageCostClient | null;
  surface: UsageCostSurface;
  taskId?: string | null;
  tenantId?: string | null;
  enterpriseId?: string | null;
  rerender?: (() => void) | null;
  force?: boolean;
}): Promise<void> {
  const key = usageCostSlotKey(input);
  const current = slots.get(key);
  if (!input.force && current && (current.status === "loading" || current.status === "ready")) {
    return;
  }
  if (!input.client?.request) {
    return;
  }
  slots.set(key, { status: "loading", view: current?.view ?? null, error: null });
  try {
    const params: Record<string, string> = { surface: input.surface };
    if (input.taskId?.trim()) {
      params.taskId = input.taskId.trim();
    }
    if (input.tenantId?.trim()) {
      params.tenantId = input.tenantId.trim();
    }
    if (input.enterpriseId?.trim()) {
      params.enterpriseId = input.enterpriseId.trim();
    }
    const payload = await input.client.request("usage.cost.layer", params);
    if (!isUsageCostView(payload) || payload.surface !== input.surface) {
      throw new Error("unexpected usage payload");
    }
    slots.set(key, { status: "ready", view: payload, error: null });
  } catch (error) {
    slots.set(key, { status: "error", view: null, error: publicUsageCostError(error) });
  }
  input.rerender?.();
}
