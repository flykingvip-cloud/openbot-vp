/**
 * In-memory File System Access handles for Chromium browser E2E.
 * Duck-typed stand-in — cast via asDirectoryHandle() for FileSystemDirectoryHandle APIs.
 */

import { asBufferSource } from "./bytes.ts";

type MemFile = {
  kind: "file";
  name: string;
  data: Uint8Array;
  lastModified: number;
};

type MemDir = {
  kind: "directory";
  name: string;
  children: Map<string, MemFile | MemDir>;
};

type WritePayload =
  | BufferSource
  | Blob
  | string
  | { type: "write"; data?: BufferSource | Blob | string; position?: number };

function asUint8(data: BufferSource | Blob | string): Promise<Uint8Array> {
  if (typeof data === "string") {
    return Promise.resolve(new TextEncoder().encode(data));
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return data.arrayBuffer().then((buf) => new Uint8Array(buf));
  }
  if (data instanceof ArrayBuffer) {
    return Promise.resolve(new Uint8Array(data));
  }
  const view = data as ArrayBufferView;
  return Promise.resolve(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

class MemoryWritableFileStream {
  #chunks: Uint8Array[] = [];
  #closed = false;
  readonly #onClose: (data: Uint8Array) => void;

  constructor(onClose: (data: Uint8Array) => void) {
    this.#onClose = onClose;
  }

  async write(data: WritePayload): Promise<void> {
    if (this.#closed) {
      throw new Error("writable closed");
    }
    let payload: BufferSource | Blob | string | undefined;
    if (
      data &&
      typeof data === "object" &&
      "type" in data &&
      (data as { type: string }).type === "write"
    ) {
      payload = (data as { data?: BufferSource | Blob | string }).data;
    } else {
      payload = data as BufferSource | Blob | string;
    }
    if (payload === undefined) {
      return;
    }
    this.#chunks.push(await asUint8(payload));
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    const total = this.#chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.#chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.#onClose(out);
  }

  async abort(): Promise<void> {
    this.#closed = true;
    this.#chunks = [];
  }
}

class MemoryFileHandle {
  readonly kind = "file" as const;
  readonly name: string;
  #node: MemFile;

  constructor(node: MemFile) {
    this.name = node.name;
    this.#node = node;
  }

  async getFile(): Promise<File> {
    return new File([asBufferSource(this.#node.data)], this.#node.name, {
      lastModified: this.#node.lastModified,
    });
  }

  async createWritable(): Promise<MemoryWritableFileStream> {
    const node = this.#node;
    return new MemoryWritableFileStream((data) => {
      node.data = data;
      node.lastModified = Date.now();
    });
  }

  async isSameEntry(other: { name?: string }): Promise<boolean> {
    return other === this;
  }
}

export class MemoryDirectoryHandle {
  readonly kind = "directory" as const;
  readonly name: string;
  readonly #node: MemDir;

  constructor(node?: MemDir) {
    this.#node = node ?? { kind: "directory", name: "", children: new Map() };
    this.name = this.#node.name;
  }

  /** Cast for APIs typed as FileSystemDirectoryHandle. */
  asDirectoryHandle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle;
  }

  /** Test helper: seed a plaintext file under this root. */
  seedFile(relativePath: string, contents: string | Uint8Array, lastModified = Date.now()): void {
    const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length === 0) {
      throw new Error("invalid path");
    }
    let dir = this.#node;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      let child = dir.children.get(name);
      if (!child || child.kind !== "directory") {
        child = { kind: "directory", name, children: new Map() };
        dir.children.set(name, child);
      }
      dir = child;
    }
    const fileName = parts[parts.length - 1];
    const data = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
    dir.children.set(fileName, {
      kind: "file",
      name: fileName,
      data: new Uint8Array(data),
      lastModified,
    });
  }

  /** Test helper: read UTF-8 file or null. */
  readText(relativePath: string): string | null {
    const bytes = this.readBytes(relativePath);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }

  readBytes(relativePath: string): Uint8Array | null {
    const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
    let node: MemFile | MemDir = this.#node;
    for (const part of parts) {
      if (node.kind !== "directory") {
        return null;
      }
      const next = node.children.get(part);
      if (!next) {
        return null;
      }
      node = next;
    }
    return node.kind === "file" ? node.data : null;
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<MemoryDirectoryHandle> {
    let child = this.#node.children.get(name);
    if (!child) {
      if (!options?.create) {
        throw new DOMException(`Directory not found: ${name}`, "NotFoundError");
      }
      child = { kind: "directory", name, children: new Map() };
      this.#node.children.set(name, child);
    }
    if (child.kind !== "directory") {
      throw new DOMException(`Not a directory: ${name}`, "TypeMismatchError");
    }
    return new MemoryDirectoryHandle(child);
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFileHandle> {
    let child = this.#node.children.get(name);
    if (!child) {
      if (!options?.create) {
        throw new DOMException(`File not found: ${name}`, "NotFoundError");
      }
      child = { kind: "file", name, data: new Uint8Array(0), lastModified: Date.now() };
      this.#node.children.set(name, child);
    }
    if (child.kind !== "file") {
      throw new DOMException(`Not a file: ${name}`, "TypeMismatchError");
    }
    return new MemoryFileHandle(child);
  }

  async removeEntry(name: string): Promise<void> {
    this.#node.children.delete(name);
  }

  async isSameEntry(other: { name?: string }): Promise<boolean> {
    return other === this;
  }

  async *entries(): AsyncGenerator<[string, MemoryDirectoryHandle | MemoryFileHandle]> {
    for (const [name, child] of this.#node.children) {
      yield [
        name,
        child.kind === "directory" ? new MemoryDirectoryHandle(child) : new MemoryFileHandle(child),
      ];
    }
  }

  async *keys(): AsyncGenerator<string> {
    for (const name of this.#node.children.keys()) {
      yield name;
    }
  }

  async *values(): AsyncGenerator<MemoryDirectoryHandle | MemoryFileHandle> {
    for await (const [, handle] of this.entries()) {
      yield handle;
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<
    [string, MemoryDirectoryHandle | MemoryFileHandle]
  > {
    return this.entries();
  }
}

export function createMemoryVaultDirectory(name = "vault-root"): MemoryDirectoryHandle {
  return new MemoryDirectoryHandle({ kind: "directory", name, children: new Map() });
}
