import { createHash, randomBytes } from "node:crypto";

export function newArtifactId(): string {
  return `art_${randomBytes(16).toString("hex")}`;
}

export function newGrantId(): string {
  return `grn_${randomBytes(16).toString("hex")}`;
}

export function sha256Of(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function sanitizeUserId(userId: string): string {
  const trimmed = userId.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("invalid_user_id");
  }
  return trimmed;
}

export function sanitizeAgentId(agentId: string): string {
  const trimmed = agentId.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("invalid_agent_id");
  }
  return trimmed;
}
