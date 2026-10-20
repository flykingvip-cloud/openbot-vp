import fs from "node:fs";
import path from "node:path";

export type WorkspaceAccessAudit = {
  resourceId: string;
  bindingId: string;
  operation: string;
  relativePath?: string;
};

function normalizeRelativePath(requested: string): string | null {
  const trimmed = requested.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\0")) {
    return null;
  }
  const segments = trimmed.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    return null;
  }
  return segments.join("/");
}

/**
 * Constrained workspace handle. Handlers use adapter methods — not raw locator strings.
 */
export class WorkspaceResourceAccess {
  readonly resourceId: string;
  readonly bindingId: string;
  readonly operation: string;
  readonly purpose: string;

  readonly #rootPath: string;

  constructor(params: {
    resourceId: string;
    bindingId: string;
    operation: string;
    purpose: string;
    rootPath: string;
  }) {
    this.resourceId = params.resourceId;
    this.bindingId = params.bindingId;
    this.operation = params.operation;
    this.purpose = params.purpose;
    this.#rootPath = path.resolve(params.rootPath);
  }

  resolveRelativePath(relativePath: string): string | null {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized) {
      return null;
    }
    const candidate = path.resolve(this.#rootPath, normalized);
    if (!isWithinRoot(this.#rootPath, candidate)) {
      return null;
    }
    return candidate;
  }

  statRelativeFile(relativePath: string): fs.Stats | null {
    const abs = this.resolveRelativePath(relativePath);
    if (!abs) {
      return null;
    }
    try {
      const stat = fs.statSync(abs);
      return stat.isFile() ? stat : null;
    } catch {
      return null;
    }
  }

  readRelativeFile(relativePath: string): Buffer | null {
    const abs = this.resolveRelativePath(relativePath);
    if (!abs) {
      return null;
    }
    try {
      return fs.readFileSync(abs);
    } catch {
      return null;
    }
  }

  writeRelativeFileUtf8(relativePath: string, content: string): boolean {
    if (this.operation !== "write") {
      return false;
    }
    const abs = this.resolveRelativePath(relativePath);
    if (!abs) {
      return false;
    }
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
      return true;
    } catch {
      return false;
    }
  }

  removeRelativeDir(relativeDir: string): boolean {
    if (this.operation !== "write") {
      return false;
    }
    const normalized = normalizeRelativePath(relativeDir);
    if (!normalized) {
      return false;
    }
    const absDir = path.resolve(this.#rootPath, normalized);
    if (!isWithinRoot(this.#rootPath, absDir)) {
      return false;
    }
    try {
      if (fs.existsSync(absDir)) {
        fs.rmSync(absDir, { recursive: true, force: true });
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  removeRelativeFileTree(relativeFilePath: string): boolean {
    const normalized = normalizeRelativePath(relativeFilePath);
    if (!normalized) {
      return false;
    }
    const parent = path.posix.dirname(normalized.replace(/\\/g, "/"));
    if (!parent || parent === ".") {
      return false;
    }
    return this.removeRelativeDir(parent);
  }

  listRelativeDir(relativeDir = ""): string[] | null {
    const normalized = relativeDir.trim() ? normalizeRelativePath(relativeDir) : "";
    if (relativeDir.trim() && !normalized) {
      return null;
    }
    const absDir = normalized ? path.resolve(this.#rootPath, normalized) : this.#rootPath;
    if (!isWithinRoot(this.#rootPath, absDir)) {
      return null;
    }
    try {
      const stat = fs.statSync(absDir);
      if (!stat.isDirectory()) {
        return null;
      }
      return fs
        .readdirSync(absDir)
        .filter((name) => !name.startsWith("."))
        .toSorted();
    } catch {
      return null;
    }
  }

  realRootPath(): string {
    try {
      return fs.realpathSync(this.#rootPath);
    } catch {
      return this.#rootPath;
    }
  }
}

function isWithinRoot(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
