import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { logWarn } from "../logger.js";
import type { FileIdentityStat } from "./file-identity.js";

export type PinnedWriteInput =
  | { kind: "buffer"; data: string | Buffer; encoding?: BufferEncoding }
  | { kind: "stream"; stream: Readable };

const LOCAL_PINNED_WRITE_PYTHON = [
  "import errno",
  "import os",
  "import secrets",
  "import stat",
  "import sys",
  "",
  "root_path = sys.argv[1]",
  "relative_parent = sys.argv[2]",
  "basename = sys.argv[3]",
  'mkdir_enabled = sys.argv[4] == "1"',
  "file_mode = int(sys.argv[5], 8)",
  "",
  "DIR_FLAGS = os.O_RDONLY",
  "if hasattr(os, 'O_DIRECTORY'):",
  "    DIR_FLAGS |= os.O_DIRECTORY",
  "if hasattr(os, 'O_NOFOLLOW'):",
  "    DIR_FLAGS |= os.O_NOFOLLOW",
  "",
  "WRITE_FLAGS = os.O_WRONLY | os.O_CREAT | os.O_EXCL",
  "if hasattr(os, 'O_NOFOLLOW'):",
  "    WRITE_FLAGS |= os.O_NOFOLLOW",
  "",
  "def open_dir(path_value, dir_fd=None):",
  "    return os.open(path_value, DIR_FLAGS, dir_fd=dir_fd)",
  "",
  "def walk_parent(root_fd, rel_parent, mkdir_enabled):",
  "    current_fd = os.dup(root_fd)",
  "    try:",
  "        for segment in [part for part in rel_parent.split('/') if part and part != '.']:",
  "            if segment == '..':",
  "                raise OSError(errno.EPERM, 'path traversal is not allowed', segment)",
  "            try:",
  "                next_fd = open_dir(segment, dir_fd=current_fd)",
  "            except FileNotFoundError:",
  "                if not mkdir_enabled:",
  "                    raise",
  "                os.mkdir(segment, 0o777, dir_fd=current_fd)",
  "                next_fd = open_dir(segment, dir_fd=current_fd)",
  "            os.close(current_fd)",
  "            current_fd = next_fd",
  "        return current_fd",
  "    except Exception:",
  "        os.close(current_fd)",
  "        raise",
  "",
  "def create_temp_file(parent_fd, basename, mode):",
  "    prefix = '.' + basename + '.'",
  "    for _ in range(128):",
  "        candidate = prefix + secrets.token_hex(6) + '.tmp'",
  "        try:",
  "            fd = os.open(candidate, WRITE_FLAGS, mode, dir_fd=parent_fd)",
  "            return candidate, fd",
  "        except FileExistsError:",
  "            continue",
  "    raise RuntimeError('failed to allocate pinned temp file')",
  "",
  "root_fd = open_dir(root_path)",
  "parent_fd = None",
  "temp_fd = None",
  "temp_name = None",
  "try:",
  "    parent_fd = walk_parent(root_fd, relative_parent, mkdir_enabled)",
  "    temp_name, temp_fd = create_temp_file(parent_fd, basename, file_mode)",
  "    while True:",
  "        chunk = sys.stdin.buffer.read(65536)",
  "        if not chunk:",
  "            break",
  "        os.write(temp_fd, chunk)",
  "    os.fsync(temp_fd)",
  "    os.close(temp_fd)",
  "    temp_fd = None",
  "    os.replace(temp_name, basename, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)",
  "    temp_name = None",
  "    os.fsync(parent_fd)",
  "    result_stat = os.stat(basename, dir_fd=parent_fd, follow_symlinks=False)",
  "    print(f'{result_stat.st_dev}|{result_stat.st_ino}')",
  "finally:",
  "    if temp_fd is not None:",
  "        os.close(temp_fd)",
  "    if temp_name is not None and parent_fd is not None:",
  "        try:",
  "            os.unlink(temp_name, dir_fd=parent_fd)",
  "        except FileNotFoundError:",
  "            pass",
  "    if parent_fd is not None:",
  "        os.close(parent_fd)",
  "    os.close(root_fd)",
].join("\n");

const PINNED_WRITE_PYTHON_BIN = "python3";

/** Raised when the python3 pinned-write helper cannot be spawned (binary missing). */
export class PinnedWriteHelperUnavailableError extends Error {
  readonly code = "ENOENT";

  constructor(
    message = "python3 missing: pinned write helper unavailable",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PinnedWriteHelperUnavailableError";
  }
}

/** Python helper failure carrying the real errno name parsed from its traceback. */
export class PinnedWriteHelperError extends Error {
  readonly code?: string;
  readonly errnoNumber?: number;

  constructor(message: string, options?: { code?: string; errnoNumber?: number }) {
    super(message);
    this.name = "PinnedWriteHelperError";
    if (options?.code) {
      this.code = options.code;
    }
    if (options?.errnoNumber !== undefined) {
      this.errnoNumber = options.errnoNumber;
    }
  }
}

const ERRNO_NAME_BY_NUMBER: Map<number, string> = (() => {
  const map = new Map<number, string>();
  for (const [name, value] of Object.entries(os.constants.errno)) {
    if (typeof value === "number" && !map.has(value)) {
      map.set(value, name);
    }
  }
  return map;
})();

/** Parse "<Exc>: [Errno N] message" from the last python traceback line. */
export function parsePinnedHelperFailure(stderr: string, fallback: string): PinnedWriteHelperError {
  const lines = stderr
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines.at(-1) ?? "";
  const match = /\[Errno (\d+)\]\s*(.*)$/u.exec(last);
  if (match) {
    const errnoNumber = Number.parseInt(match[1] ?? "", 10);
    const code = ERRNO_NAME_BY_NUMBER.get(errnoNumber);
    const message = (match[2] ?? "").trim() || last;
    return new PinnedWriteHelperError(code ? `${code}: ${message}` : message, {
      code,
      errnoNumber,
    });
  }
  return new PinnedWriteHelperError(last || fallback);
}

let pinnedHelperAvailability: Promise<boolean> | undefined;

function probePinnedWriteHelper(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    try {
      const child = spawn(PINNED_WRITE_PYTHON_BIN, ["-c", "import os"], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      child.once("error", () => finish(false));
      child.once("close", (code) => finish(code === 0));
    } catch {
      finish(false);
    }
  });
}

/**
 * Whether the python3 pinned-write helper can run on this host. Probed once per
 * process (one spawn) and cached so missing python3 never costs a failed spawn
 * per file. `OPENBOT_FS_SAFE_NATIVE_WRITES=1` forces the native Node path.
 */
export async function isPinnedWriteHelperAvailable(): Promise<boolean> {
  if (process.env.OPENBOT_FS_SAFE_NATIVE_WRITES === "1") {
    return false;
  }
  pinnedHelperAvailability ??= probePinnedWriteHelper().then((available) => {
    if (!available) {
      logWarn(
        "fs-safe: python3 not found; using native Node atomic writes (O_NOFOLLOW + temp/rename) for root-scoped writes",
      );
    }
    return available;
  });
  return await pinnedHelperAvailability;
}

/** Test hook: force (true/false) or reset (undefined) the cached probe result. */
export function setPinnedWriteHelperAvailabilityForTest(value: boolean | undefined): void {
  pinnedHelperAvailability = value === undefined ? undefined : Promise.resolve(value);
}

function parsePinnedIdentity(stdout: string): FileIdentityStat {
  const line = stdout
    .trim()
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) {
    throw new Error("Pinned write helper returned no identity");
  }
  const [devRaw, inoRaw] = line.split("|");
  const dev = Number.parseInt(devRaw ?? "", 10);
  const ino = Number.parseInt(inoRaw ?? "", 10);
  if (!Number.isFinite(dev) || !Number.isFinite(ino)) {
    throw new Error(`Pinned write helper returned invalid identity: ${line}`);
  }
  return { dev, ino };
}

export async function runPinnedWriteHelper(params: {
  rootPath: string;
  relativeParentPath: string;
  basename: string;
  mkdir: boolean;
  mode: number;
  input: PinnedWriteInput;
}): Promise<FileIdentityStat> {
  const child = spawn(
    PINNED_WRITE_PYTHON_BIN,
    [
      "-c",
      LOCAL_PINNED_WRITE_PYTHON,
      params.rootPath,
      params.relativeParentPath,
      params.basename,
      params.mkdir ? "1" : "0",
      (params.mode || 0o600).toString(8),
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding?.("utf8");
  child.stderr.setEncoding?.("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitPromise = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>;
  void exitPromise.catch(() => {});
  // Wait for the process to actually start so a missing python3 surfaces as a
  // clear PinnedWriteHelperUnavailableError before any input is consumed.
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
  } catch (error) {
    await exitPromise.catch(() => {});
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      pinnedHelperAvailability = Promise.resolve(false);
      throw new PinnedWriteHelperUnavailableError(undefined, { cause: error });
    }
    throw error;
  }
  try {
    if (!child.stdin) {
      const identity = await runPinnedWriteFallback(params);
      await exitPromise.catch(() => {});
      return identity;
    }

    if (params.input.kind === "buffer") {
      const input = params.input;
      await new Promise<void>((resolve, reject) => {
        child.stdin.once("error", reject);
        if (typeof input.data === "string") {
          child.stdin.end(input.data, input.encoding ?? "utf8", () => resolve());
          return;
        }
        child.stdin.end(input.data, () => resolve());
      });
    } else {
      await pipeline(params.input.stream, child.stdin);
    }

    const [code, signal] = await exitPromise;
    if (code !== 0) {
      throw parsePinnedHelperFailure(
        stderr,
        `Pinned write helper failed with code ${code ?? "null"} (${signal ?? "?"})`,
      );
    }
    return parsePinnedIdentity(stdout);
  } catch (error) {
    child.kill("SIGKILL");
    await exitPromise.catch(() => {});
    throw error;
  }
}

async function runPinnedWriteFallback(params: {
  rootPath: string;
  relativeParentPath: string;
  basename: string;
  mkdir: boolean;
  mode: number;
  input: PinnedWriteInput;
}): Promise<FileIdentityStat> {
  const parentPath = params.relativeParentPath
    ? path.join(params.rootPath, ...params.relativeParentPath.split("/"))
    : params.rootPath;
  if (params.mkdir) {
    await fs.mkdir(parentPath, { recursive: true });
  }
  const targetPath = path.join(parentPath, params.basename);
  const tempPath = path.join(parentPath, `.${params.basename}.fallback.tmp`);
  if (params.input.kind === "buffer") {
    if (typeof params.input.data === "string") {
      await fs.writeFile(tempPath, params.input.data, {
        encoding: params.input.encoding ?? "utf8",
        mode: params.mode,
      });
    } else {
      await fs.writeFile(tempPath, params.input.data, { mode: params.mode });
    }
  } else {
    const handle = await fs.open(tempPath, "w", params.mode);
    try {
      await pipeline(params.input.stream, handle.createWriteStream());
    } finally {
      await handle.close().catch(() => {});
    }
  }
  await fs.rename(tempPath, targetPath);
  const stat = await fs.stat(targetPath);
  return { dev: stat.dev, ino: stat.ino };
}
