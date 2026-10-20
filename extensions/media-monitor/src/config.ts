import { buildSecretInputSchema } from "openclaw/plugin-sdk/media-monitor";
import type { OpenClawPluginConfigSchema } from "openclaw/plugin-sdk/media-monitor";
import { z } from "zod";

const secretInputSchema = buildSecretInputSchema();

export const mediaMonitorPluginConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  adapterCommand: z.array(z.string().min(1)).min(1).optional(),
  adapterCwd: z.string().optional(),
  defaultPlatform: z.literal("xhs").optional().default("xhs"),
  defaultPollIntervalSeconds: z.number().min(60).optional().default(1800),
  timeoutMs: z.number().min(1000).optional().default(120_000),
  maxStdoutBytes: z
    .number()
    .min(1024)
    .optional()
    .default(10 * 1024 * 1024),
  tickIntervalMs: z.number().min(1000).optional().default(30_000),
  outboxFlushIntervalMs: z.number().min(1000).optional().default(15_000),
  notifyChannel: z.string().optional(),
  notifyTo: z.string().optional(),
  notifyAccountId: z.string().optional(),
  cookieSecret: secretInputSchema.optional(),
  staggerMs: z.number().min(0).optional().default(5_000),
});

export type MediaMonitorPluginConfig = z.infer<typeof mediaMonitorPluginConfigSchema>;

export function createMediaMonitorConfigSchema(): OpenClawPluginConfigSchema {
  return {
    safeParse(value: unknown) {
      const parsed = mediaMonitorPluginConfigSchema.safeParse(value ?? {});
      if (!parsed.success) {
        return {
          success: false as const,
          error: {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.map(String),
              message: issue.message,
            })),
          },
        };
      }
      return { success: true as const, data: parsed.data };
    },
  };
}

export function resolvePluginConfig(raw: unknown): MediaMonitorPluginConfig {
  return mediaMonitorPluginConfigSchema.parse(raw ?? {});
}
