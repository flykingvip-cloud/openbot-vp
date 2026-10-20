import { z } from "zod";

const DingtalkDmSchema = z
  .object({
    policy: z.enum(["open", "pairing", "allowlist"]).optional(),
    allowFrom: z.array(z.string()).optional(),
  })
  .optional();

const DingtalkAccountSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().optional(),
  clientId: z.string(),
  clientSecret: z.string().optional(),
  connectionMode: z.enum(["stream", "webhook"]).optional(),
  robotCode: z.string().optional(),
  webhookPath: z.string().optional(),
  webhookUrl: z.string().optional(),
  defaultTo: z.string().optional(),
  cooldownId: z.string().optional(),
  dm: DingtalkDmSchema,
  textChunkLimit: z.number().optional(),
});

export const DingtalkConfigSchema = z.object({
  enabled: z.boolean().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  connectionMode: z.enum(["stream", "webhook"]).optional(),
  robotCode: z.string().optional(),
  webhookPath: z.string().optional(),
  webhookUrl: z.string().optional(),
  defaultTo: z.string().optional(),
  name: z.string().optional(),
  defaultAccount: z.string().optional(),
  dm: DingtalkDmSchema,
  textChunkLimit: z.number().optional(),
  accounts: z.record(z.string(), DingtalkAccountSchema).optional(),
});

export type DingtalkConfig = z.infer<typeof DingtalkConfigSchema>;
