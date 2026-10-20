import {
  buildCatchallMultiAccountChannelSchema,
  buildNestedDmConfigSchema,
} from "openclaw/plugin-sdk/wecom";
import { z } from "zod";

const wecomAccountSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().optional(),
  connectionMode: z.enum(["callback", "websocket"]).optional(),
  botId: z.string().optional(),
  corpId: z.string().optional(),
  agentId: z.union([z.string(), z.number()]).optional(),
  secret: z.string().optional(),
  token: z.string().optional(),
  encodingAesKey: z.string().optional(),
  webhookPath: z.string().optional(),
  webhookUrl: z.string().optional(),
  defaultTo: z.string().optional(),
  dm: buildNestedDmConfigSchema(),
  textChunkLimit: z.number().int().positive().optional(),
});

export const WecomConfigSchema = buildCatchallMultiAccountChannelSchema(wecomAccountSchema);
