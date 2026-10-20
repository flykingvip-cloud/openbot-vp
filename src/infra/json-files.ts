import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export type JsonAtomicWriteOptions = {
  mode?: number;
  trailingNewline?: boolean;
  ensureDirMode?: number;
};

export type TextAtomicWriteOptions = {
  mode?: number;
  ensureDirMode?: number;
  appendTrailingNewline?: boolean;
};

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  options?: JsonAtomicWriteOptions,
) {
  const text = JSON.stringify(value, null, 2);
  await writeTextAtomic(filePath, text, {
    mode: options?.mode,
    ensureDirMode: options?.ensureDirMode,
    appendTrailingNewline: options?.trailingNewline,
  });
}

/**
 * Sync counterpart of `writeJsonAtomic` for remaining sync store APIs
 * (auth-profiles, CLI credential files). Same protocol: tmp + chmod 0o600 + rename.
 * New stores must use the async `writeJsonAtomic`.
 */
export function writeJsonAtomicSync(
  filePath: string,
  value: unknown,
  options?: JsonAtomicWriteOptions,
) {
  const text = JSON.stringify(value, null, 2);
  writeTextAtomicSync(filePath, text, {
    mode: options?.mode,
    ensureDirMode: options?.ensureDirMode,
    appendTrailingNewline: options?.trailingNewline,
  });
}

export async function writeTextAtomic(
  filePath: string,
  content: string,
  options?: TextAtomicWriteOptions,
) {
  const mode = options?.mode ?? 0o600;
  const payload =
    options?.appendTrailingNewline && !content.endsWith("\n") ? `${content}\n` : content;
  const mkdirOptions: { recursive: true; mode?: number } = { recursive: true };
  if (typeof options?.ensureDirMode === "number") {
    mkdirOptions.mode = options.ensureDirMode;
  }
  await fs.mkdir(path.dirname(filePath), mkdirOptions);
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, payload, "utf8");
    try {
      await fs.chmod(tmp, mode);
    } catch {
      // best-effort; ignore on platforms without chmod
    }
    await fs.rename(tmp, filePath);
    try {
      await fs.chmod(filePath, mode);
    } catch {
      // best-effort; ignore on platforms without chmod
    }
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

function writeTextAtomicSync(filePath: string, content: string, options?: TextAtomicWriteOptions) {
  const mode = options?.mode ?? 0o600;
  const payload =
    options?.appendTrailingNewline && !content.endsWith("\n") ? `${content}\n` : content;
  const mkdirOptions: { recursive: true; mode?: number } = { recursive: true };
  if (typeof options?.ensureDirMode === "number") {
    mkdirOptions.mode = options.ensureDirMode;
  }
  fsSync.mkdirSync(path.dirname(filePath), mkdirOptions);
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  try {
    fsSync.writeFileSync(tmp, payload, "utf8");
    try {
      fsSync.chmodSync(tmp, mode);
    } catch {
      // best-effort; ignore on platforms without chmod
    }
    fsSync.renameSync(tmp, filePath);
    try {
      fsSync.chmodSync(filePath, mode);
    } catch {
      // best-effort; ignore on platforms without chmod
    }
  } finally {
    try {
      fsSync.rmSync(tmp, { force: true });
    } catch {
      // ignore leftover tmp cleanup failures
    }
  }
}

export function createAsyncLock() {
  let lock: Promise<void> = Promise.resolve();
  return async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = lock;
    let release: (() => void) | undefined;
    lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release?.();
    }
  };
}
