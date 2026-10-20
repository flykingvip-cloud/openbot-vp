import { z } from "zod";

const WechatDmSchema = z
  .object({
    policy: z.enum(["open", "pairing", "allowlist"]).optional(),
    allowFrom: z.array(z.string()).optional(),
  })
  .optional();

const WechatAccountSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().optional(),
  apiKey: z.string(),
  proxyUrl: z.string(),
  webhookHost: z.string().optional(),
  webhookPort: z.number().optional(),
  webhookPath: z.string().optional(),
  deviceType: z.enum(["ipad", "mac"]).optional(),
  defaultTo: z.string().optional(),
  dm: WechatDmSchema,
  textChunkLimit: z.number().optional(),
});

export const WechatConfigSchema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().optional(),
  proxyUrl: z.string().optional(),
  webhookHost: z.string().optional(),
  webhookPort: z.number().optional(),
  webhookPath: z.string().optional(),
  deviceType: z.enum(["ipad", "mac"]).optional(),
  defaultTo: z.string().optional(),
  name: z.string().optional(),
  defaultAccount: z.string().optional(),
  dm: WechatDmSchema,
  textChunkLimit: z.number().optional(),
  accounts: z.record(z.string(), WechatAccountSchema).optional(),
});

export type WechatConfig = z.infer<typeof WechatConfigSchema>;
