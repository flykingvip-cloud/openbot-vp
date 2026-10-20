/**
 * Model port for the device digital-human loopback stub.
 * Placeholder mode is the offline hatch. Agent mode is implemented by agent-client.ts.
 */

export type DeviceDhModelMode = "placeholder" | "agent";

export type DeviceDhTurnContext = {
  text: string;
  digitalHumanId: string;
  displayName: string;
  locale?: string;
  conversationId: string;
  onDelta: (delta: string) => void;
};

export type DeviceDhVisionContext = {
  userText: string;
  bytes: Buffer;
  contentType: string;
  width: number;
  height: number;
  digitalHumanId: string;
  displayName: string;
  locale?: string;
  conversationId: string;
  onDelta: (delta: string) => void;
};

export type DeviceDhModelClient = {
  readonly mode: DeviceDhModelMode;
  /** Origin or hatch name, never a credential. */
  readonly target: string;
  completeTurn(ctx: DeviceDhTurnContext): Promise<string>;
  describeImage(ctx: DeviceDhVisionContext): Promise<string>;
};

export class DeviceDhModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceDhModelError";
  }
}

const INVENTORY_MUTATION_CLAIM =
  /库存已更新|已更新库存|已修改库存|已写入库存|库存已经更新|inventory (?:has been|was) updated/i;

export function resolveDeviceDhModelMode(env: NodeJS.ProcessEnv = process.env): DeviceDhModelMode {
  if (env.OPENBOT_DEVICE_DH_STUB_PLACEHOLDER === "1") {
    return "placeholder";
  }
  const requested = env.OPENBOT_DEVICE_DH_MODEL_MODE?.trim().toLowerCase();
  if (requested && requested !== "agent" && requested !== "placeholder") {
    throw new DeviceDhModelError("OPENBOT_DEVICE_DH_MODEL_MODE must be agent or placeholder");
  }
  if (requested === "agent" || env.OPENBOT_DEVICE_DH_AGENT === "1") {
    return "agent";
  }
  return "placeholder";
}

/** Drop sentences that claim an inventory write. This stub never calls inventory MCP. */
export function dropInventoryMutationClaims(text: string): string {
  const parts = text.split(/(?<=[。！？!?\n])/);
  const kept = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !INVENTORY_MUTATION_CLAIM.test(part));
  return kept.join("").trim();
}

export function createPlaceholderModelClient(): DeviceDhModelClient {
  return {
    mode: "placeholder",
    target: "placeholder",
    async completeTurn(ctx) {
      const visible = placeholderText(ctx.text);
      const delta = visible.slice(0, 6);
      if (delta) {
        ctx.onDelta(delta);
      }
      return visible;
    },
    async describeImage(ctx) {
      return (
        `占位视觉：收到 ${ctx.contentType} 图片（${ctx.width}x${ctx.height}，${ctx.bytes.length} 字节）。` +
        "识别结果为占位，未修改库存。"
      );
    },
  };
}

function placeholderText(text: string): string {
  if (/库存/.test(text)) {
    return "占位回复：库存查询需要业务 MCP。当前 stub 未接入，不能播报库存结果。";
  }
  return `占位回复：已收到「${text}」。当前为设备数字人 stub，未调用真实模型。`;
}
