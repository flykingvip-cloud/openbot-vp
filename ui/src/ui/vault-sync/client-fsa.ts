const handlesByKey = new Map<string, FileSystemDirectoryHandle>();

type DirectoryPickerWindow = Window &
  typeof globalThis & {
    showDirectoryPicker: (options?: {
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  };

export function vaultDirectoryKey(vaultId: string, deviceId: string): string {
  return `${vaultId}:${deviceId}`;
}

export function rememberVaultDirectoryHandle(key: string, handle: FileSystemDirectoryHandle): void {
  handlesByKey.set(key, handle);
}

export function getVaultDirectoryHandle(key: string): FileSystemDirectoryHandle | null {
  return handlesByKey.get(key) ?? null;
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickVaultDirectoryHandle(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error("File System Access API is not available in this browser");
  }
  return (window as DirectoryPickerWindow).showDirectoryPicker({ mode: "readwrite" });
}

export type WalkedVaultFile = {
  relativePath: string;
  fileName: string;
  sizeBytes: number;
  mtimeMs: number;
  file: File;
};

const MAX_WALK_FILES = 2000;

export async function walkVaultDirectory(
  root: FileSystemDirectoryHandle,
): Promise<WalkedVaultFile[]> {
  const out: WalkedVaultFile[] = [];

  async function visit(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    if (out.length >= MAX_WALK_FILES) {
      return;
    }
    for await (const entry of dir.values()) {
      if (out.length >= MAX_WALK_FILES) {
        break;
      }
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        await visit(entry, relativePath);
        continue;
      }
      if (entry.kind !== "file") {
        continue;
      }
      const file = await entry.getFile();
      out.push({
        relativePath,
        fileName: entry.name,
        sizeBytes: file.size,
        mtimeMs: file.lastModified,
        file,
      });
    }
  }

  await visit(root, "");
  return out;
}

export async function writeVaultFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  data: Uint8Array,
): Promise<void> {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) {
    throw new Error("invalid path");
  }
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(new Uint8Array(data));
  await writable.close();
}

export async function ensureVaultDirectoryHandle(params: {
  vaultId: string;
  deviceId: string;
  existing?: FileSystemDirectoryHandle | null;
}): Promise<FileSystemDirectoryHandle> {
  const key = vaultDirectoryKey(params.vaultId, params.deviceId);
  const cached = params.existing ?? getVaultDirectoryHandle(key);
  if (cached) {
    return cached;
  }
  const picked = await pickVaultDirectoryHandle();
  rememberVaultDirectoryHandle(key, picked);
  return picked;
}
