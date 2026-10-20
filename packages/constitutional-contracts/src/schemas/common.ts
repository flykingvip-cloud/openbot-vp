import { z } from "zod";

export const CLAIM_LEVELS = [
  "code-present",
  "runtime-enabled",
  "production-proven",
  "unknown",
] as const;

export const ClaimLevelSchema = z.enum(CLAIM_LEVELS);
export type ClaimLevel = z.infer<typeof ClaimLevelSchema>;

export const CONSTITUTIONAL_SCHEMA_VERSION = 1 as const;
