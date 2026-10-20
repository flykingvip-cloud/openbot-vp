/**
 * Node/fs-backed local vault IO for dual-device E2E (Chromium FSA stand-in).
 * Browser sync continues to use File System Access via client-fsa.ts.
 */
import fs from "node:fs";
import path from "node:path";
import type { WalkedVaultFile } from "./client-fsa.ts";

export type VaultLocalFs = {
  walk(): Promise<WalkedVaultFile[]>;
  write(relativePath: string, data: Uint8Array): Promise<void>;
  read?(relativePath: string): Promise<Uint8Array>;
};

const MAX_WALK_FILES = 2000;

function normalizeRelative(relativePath: string): string {
  return relativePath
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^\/+/, "");
}

function assertSafeRelative(relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  if (!normalized || normalized.includes("..")) {
    throw new Error("invalid relative path");
  }
  return normalized;
}

export function createNodeVaultLocalFs(rootDir: string): VaultLocalFs {
  const root = path.resolve(rootDir);
  fs.mkdirSync(root, { recursive: true });

  return {
    async walk(): Promise<WalkedVaultFile[]> {
      const out: WalkedVaultFile[] = [];
      const walkRec = (dir: string, prefix: string) => {
        if (out.length >= MAX_WALK_FILES) {
          return;
        }
        for (const name of fs.readdirSync(dir)) {
          if (out.length >= MAX_WALK_FILES) {
            break;
          }
          const abs = path.join(dir, name);
          const st = fs.statSync(abs);
          const relativePath = prefix ? `${prefix}/${name}` : name;
          if (st.isDirectory()) {
            walkRec(abs, relativePath);
            continue;
          }
          if (!st.isFile()) {
            continue;
          }
          const bytes = fs.readFileSync(abs);
          out.push({
            relativePath,
            fileName: name,
            sizeBytes: st.size,
            mtimeMs: Math.floor(st.mtimeMs),
            file: new File([bytes], name, { lastModified: Math.floor(st.mtimeMs) }),
          });
        }
      };
      walkRec(root, "");
      return out.toSorted((a, b) => a.relativePath.localeCompare(b.relativePath));
    },

    async write(relativePath: string, data: Uint8Array): Promise<void> {
      const normalized = assertSafeRelative(relativePath);
      const abs = path.join(root, ...normalized.split("/"));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(data));
    },

    async read(relativePath: string): Promise<Uint8Array> {
      const normalized = assertSafeRelative(relativePath);
      const abs = path.join(root, ...normalized.split("/"));
      return new Uint8Array(fs.readFileSync(abs));
    },
  };
}
