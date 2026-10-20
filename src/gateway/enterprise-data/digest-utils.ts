import { createHash } from "node:crypto";

export function sha256Digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function hashObjectKey(tenantId: string, objectType: string, objectKey: string): string {
  return createHash("sha256").update(`${tenantId}:${objectType}:${objectKey}`).digest("hex");
}

export function objectKeyHint(objectType: string, objectKey: string): string {
  const tail = objectKey.length > 4 ? objectKey.slice(-4) : objectKey;
  return `${objectType}:***${tail}`;
}
