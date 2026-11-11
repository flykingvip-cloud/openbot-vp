import { randomBytes } from "node:crypto";

export function randomHexId(prefix: string, bytes = 16): string {
  return `${prefix}${randomBytes(bytes).toString("hex")}`;
}

export function newTaskId(): string {
  return randomHexId("tsk_");
}

export function newArtifactId(): string {
  return randomHexId("art_");
}
