import fs from "node:fs";
import path from "node:path";
import {
  parseCognitiveProvenanceBinding,
  provenanceBindingIdFor,
  provenanceRefsEqual,
  resolveCognitiveProvenanceBindingPath,
} from "./cognitive-provenance-store.js";
import type { ActorRef, CognitiveProvenanceBinding, CognitiveProvenanceRef } from "./types.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withExclusiveLockAsync(lockPath: string, fn: () => void): Promise<void> {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        fn();
        return;
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      await sleepAsync(LOCK_RETRY_MS);
    }
  }
  throw new Error("cognitive_provenance_lock_timeout");
}

function writeDurable(dest: string, value: unknown): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, dest);
}

export type CreateProvenanceBindingResult =
  | { ok: true; binding: CognitiveProvenanceBinding; created: boolean }
  | { ok: false; error: "idempotent_mismatch" | "stale_binding" };

/** Command-boundary unique-create. Not a public store export. */
export async function createCognitiveProvenanceBindingUnique(params: {
  resourceId: string;
  tenantId: string | null;
  ref: CognitiveProvenanceRef;
  previousBindingId: string | null;
  actor: ActorRef;
  stateDir?: string;
}): Promise<CreateProvenanceBindingResult> {
  const bindingId = provenanceBindingIdFor({ resourceId: params.resourceId, ref: params.ref });
  const dest = resolveCognitiveProvenanceBindingPath({ ...params, bindingId });
  const lockPath = `${dest}.lock`;
  let result: CreateProvenanceBindingResult | null = null;
  await withExclusiveLockAsync(lockPath, () => {
    if (fs.existsSync(dest)) {
      const existing = parseCognitiveProvenanceBinding(JSON.parse(fs.readFileSync(dest, "utf8")), {
        resourceId: params.resourceId,
        tenantId: params.tenantId,
        bindingId,
      });
      if (!existing) {
        throw new Error("cognitive_provenance_binding_corrupt");
      }
      if (!provenanceRefsEqual(existing.ref, params.ref)) {
        result = { ok: false, error: "idempotent_mismatch" };
        return;
      }
      if (existing.previousBindingId !== params.previousBindingId) {
        result = { ok: false, error: "stale_binding" };
        return;
      }
      result = { ok: true, binding: existing, created: false };
      return;
    }
    const binding: CognitiveProvenanceBinding = {
      bindingId,
      resourceId: params.resourceId,
      tenantId: params.tenantId,
      ref: params.ref,
      previousBindingId: params.previousBindingId,
      createdAt: new Date().toISOString(),
      actor: params.actor,
    };
    writeDurable(dest, binding);
    result = { ok: true, binding, created: true };
  });
  if (!result) {
    throw new Error("cognitive_provenance_create_failed");
  }
  return result;
}
