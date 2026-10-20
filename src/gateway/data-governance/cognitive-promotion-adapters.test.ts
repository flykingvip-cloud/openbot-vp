import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveContainedAdapterObjectPath } from "./cognitive-promotion-adapter-path.js";
import {
  byosObjectPath,
  coldArchiveObjectPath,
  dedicatedRegionalObjectPath,
  encryptByosObject,
  encryptColdArchiveObject,
  encryptDedicatedRegionalObject,
  encryptTenantManagedCloudObject,
  tenantManagedCloudObjectPath,
  unlinkByosObject,
  unlinkColdArchiveObject,
  unlinkDedicatedRegionalObject,
  unlinkTenantManagedCloudObject,
  writeByosObject,
  writeColdArchiveObject,
  writeDedicatedRegionalObject,
  writeTenantManagedCloudObject,
  type EncryptedCloudObject,
} from "./cognitive-promotion-adapters.js";
import {
  resolveByosRoot,
  resolveColdArchiveRoot,
  resolveDedicatedRegionalRoot,
  resolveTenantManagedCloudRoot,
} from "./paths.js";

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const REGION = "us-west-2";
const OBJECT_KEY = "ws-p4b-1";

const previousKey = process.env.OPENBOT_PROMOTION_KEY_HMAC_KEY;

afterEach(() => {
  if (previousKey === undefined) {
    delete process.env.OPENBOT_PROMOTION_KEY_HMAC_KEY;
  } else {
    process.env.OPENBOT_PROMOTION_KEY_HMAC_KEY = previousKey;
  }
});

function tmpStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "p4-later-path-"));
}

function stubObject(tenantId = TENANT): EncryptedCloudObject {
  return {
    kind: "byos_object",
    tenantId,
    region: REGION,
    keyRefId: `byos-keyref:${tenantId}`,
    wrapKeyId: `wrap:byos_customer:${tenantId}`,
    iv: "iv",
    tag: "tag",
    wrappedDek: "wrap",
    ciphertext: "ct",
  };
}

const laterWavePaths = [
  {
    name: "byos",
    pathOf: byosObjectPath,
    write: writeByosObject,
    unlink: unlinkByosObject,
    rootOf: resolveByosRoot,
  },
  {
    name: "dedicated",
    pathOf: dedicatedRegionalObjectPath,
    write: writeDedicatedRegionalObject,
    unlink: unlinkDedicatedRegionalObject,
    rootOf: resolveDedicatedRegionalRoot,
  },
  {
    name: "tenant-cloud",
    pathOf: tenantManagedCloudObjectPath,
    write: writeTenantManagedCloudObject,
    unlink: unlinkTenantManagedCloudObject,
    rootOf: resolveTenantManagedCloudRoot,
  },
  {
    name: "cold-archive",
    pathOf: coldArchiveObjectPath,
    write: writeColdArchiveObject,
    unlink: unlinkColdArchiveObject,
    rootOf: resolveColdArchiveRoot,
  },
] as const;

describe("later-wave adapter object path containment", () => {
  it.each(laterWavePaths)(
    "$name keeps a valid object inside the tenant prefix",
    ({ pathOf, rootOf }) => {
      const stateDir = tmpStateDir();
      const dest = pathOf({
        stateDir,
        tenantId: TENANT,
        region: REGION,
        objectKey: OBJECT_KEY,
      });
      const root = path.resolve(rootOf(stateDir));
      const rel = path.relative(root, dest);
      expect(rel.startsWith("..")).toBe(false);
      expect(path.isAbsolute(rel)).toBe(false);
      expect(rel.split(path.sep)[0]).toBe(TENANT);
    },
  );

  it.each(laterWavePaths)("$name rejects ../escape in objectKey", ({ pathOf, write, rootOf }) => {
    const stateDir = tmpStateDir();
    expect(() =>
      pathOf({
        stateDir,
        tenantId: TENANT,
        region: REGION,
        objectKey: "../escaped",
      }),
    ).toThrow(/unsafe_object_path/);
    expect(() =>
      write({
        stateDir,
        objectKey: "../escaped",
        object: stubObject(),
      }),
    ).toThrow(/unsafe_object_path/);
    const escaped = path.resolve(rootOf(stateDir), "escaped");
    expect(fs.existsSync(escaped)).toBe(false);
  });

  it.each(laterWavePaths)("$name rejects absolute objectKey and tenantId", ({ pathOf, write }) => {
    const stateDir = tmpStateDir();
    expect(() =>
      pathOf({
        stateDir,
        tenantId: TENANT,
        region: REGION,
        objectKey: "/tmp/evil",
      }),
    ).toThrow(/unsafe_object_path/);
    expect(() =>
      pathOf({
        stateDir,
        tenantId: "/etc",
        region: REGION,
        objectKey: OBJECT_KEY,
      }),
    ).toThrow(/unsafe_object_path/);
    expect(() =>
      write({
        stateDir,
        objectKey: "/tmp/evil",
        object: stubObject(),
      }),
    ).toThrow(/unsafe_object_path/);
  });

  it.each(laterWavePaths)(
    "$name rejects cross-tenant path segments on write and unlink",
    ({ pathOf, write, unlink, rootOf }) => {
      const stateDir = tmpStateDir();
      const otherDir = path.join(rootOf(stateDir), OTHER_TENANT, REGION);
      fs.mkdirSync(otherDir, { recursive: true });
      const bait = path.join(otherDir, "secret");
      fs.writeFileSync(bait, "keep\n");

      expect(() =>
        pathOf({
          stateDir,
          tenantId: TENANT,
          region: REGION,
          objectKey: `../${OTHER_TENANT}/secret`,
        }),
      ).toThrow(/unsafe_object_path/);
      expect(() =>
        pathOf({
          stateDir,
          tenantId: `../${OTHER_TENANT}`,
          region: REGION,
          objectKey: OBJECT_KEY,
        }),
      ).toThrow(/unsafe_object_path/);
      expect(() =>
        write({
          stateDir,
          objectKey: `../${OTHER_TENANT}/secret`,
          object: stubObject(),
        }),
      ).toThrow(/unsafe_object_path/);
      expect(() =>
        unlink({
          stateDir,
          tenantId: TENANT,
          region: REGION,
          objectKey: `../${OTHER_TENANT}/secret`,
        }),
      ).toThrow(/unsafe_object_path/);
      expect(fs.readFileSync(bait, "utf8")).toBe("keep\n");
    },
  );

  it("contained byos write then unlink does not touch a sibling tenant", () => {
    const stateDir = tmpStateDir();
    const root = resolveByosRoot(stateDir);
    const otherDir = path.join(root, OTHER_TENANT, REGION);
    fs.mkdirSync(otherDir, { recursive: true });
    const bait = path.join(otherDir, OBJECT_KEY);
    fs.writeFileSync(bait, "keep\n");
    const dest = writeByosObject({
      stateDir,
      objectKey: OBJECT_KEY,
      object: stubObject(),
    });
    expect(dest.startsWith(path.resolve(root, TENANT) + path.sep)).toBe(true);
    expect(fs.existsSync(dest)).toBe(true);
    unlinkByosObject({
      stateDir,
      tenantId: TENANT,
      region: REGION,
      objectKey: OBJECT_KEY,
    });
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.readFileSync(bait, "utf8")).toBe("keep\n");
  });

  it("write and unlink share the contained resolver (byos bait outside root survives)", () => {
    const stateDir = tmpStateDir();
    const bait = path.join(stateDir, "outside.txt");
    fs.writeFileSync(bait, "keep\n");
    expect(() =>
      unlinkByosObject({
        stateDir,
        tenantId: TENANT,
        region: REGION,
        objectKey: "../../../../outside.txt",
      }),
    ).toThrow(/unsafe_object_path/);
    expect(fs.readFileSync(bait, "utf8")).toBe("keep\n");
  });

  it("shared resolver rejects region traversal even after resolve", () => {
    const root = path.join(tmpStateDir(), "data-governance", "byos");
    fs.mkdirSync(root, { recursive: true });
    expect(() =>
      resolveContainedAdapterObjectPath({
        root,
        tenantId: TENANT,
        region: "..",
        objectKey: OBJECT_KEY,
      }),
    ).toThrow(/unsafe_object_path/);
  });
});

describe("later-wave encrypt keyRef.kind runtime checks", () => {
  const bytes = Buffer.from("canonical");

  beforeEach(() => {
    process.env.OPENBOT_PROMOTION_KEY_HMAC_KEY = "test-promotion-hmac-key";
  });

  it("encryptByosObject rejects dedicated and platform keyRefs", () => {
    expect(() =>
      encryptByosObject({
        bytes,
        tenantId: TENANT,
        region: REGION,
        keyRef: {
          kind: "dedicated_tenant",
          keyRefId: `dedicated-keyref:${TENANT}`,
          tenantId: TENANT,
        } as never,
      }),
    ).toThrow(/dedicated_key_unsupported/);
    expect(() =>
      encryptByosObject({
        bytes,
        tenantId: TENANT,
        region: REGION,
        keyRef: {
          kind: "platform_tenant",
          keyRefId: `platform-keyref:${TENANT}`,
          tenantId: TENANT,
        } as never,
      }),
    ).toThrow(/dedicated_key_unsupported/);
  });

  it("encryptDedicatedRegionalObject rejects a platform keyRef", () => {
    expect(() =>
      encryptDedicatedRegionalObject({
        bytes,
        tenantId: TENANT,
        region: REGION,
        keyRef: {
          kind: "platform_tenant",
          keyRefId: `platform-keyref:${TENANT}`,
          tenantId: TENANT,
        } as never,
      }),
    ).toThrow(/dedicated_key_unsupported/);
  });

  it("encryptTenantManagedCloudObject rejects a dedicated keyRef", () => {
    expect(() =>
      encryptTenantManagedCloudObject({
        bytes,
        tenantId: TENANT,
        region: REGION,
        keyRef: {
          kind: "dedicated_tenant",
          keyRefId: `dedicated-keyref:${TENANT}`,
          tenantId: TENANT,
        } as never,
      }),
    ).toThrow(/dedicated_key_unsupported/);
  });

  it("encryptColdArchiveObject rejects platform, dedicated, and byos keyRefs", () => {
    expect(() =>
      encryptColdArchiveObject({
        bytes,
        tenantId: TENANT,
        region: REGION,
        keyRef: {
          kind: "platform_tenant",
          keyRefId: `platform-keyref:${TENANT}`,
          tenantId: TENANT,
        } as never,
      }),
    ).toThrow(/dedicated_key_unsupported/);
    expect(() =>
      encryptColdArchiveObject({
        bytes,
        tenantId: TENANT,
        region: REGION,
        keyRef: {
          kind: "dedicated_tenant",
          keyRefId: `dedicated-keyref:${TENANT}`,
          tenantId: TENANT,
        } as never,
      }),
    ).toThrow(/dedicated_key_unsupported/);
    expect(() =>
      encryptColdArchiveObject({
        bytes,
        tenantId: TENANT,
        region: REGION,
        keyRef: {
          kind: "byos_customer",
          keyRefId: `byos-keyref:${TENANT}`,
          tenantId: TENANT,
        } as never,
      }),
    ).toThrow(/dedicated_key_unsupported/);
  });
});
