import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getModelGrant, setModelGrant, setModelGrantsAtomic } from "./seat-model-grant-store.js";

const tempDirs: string[] = [];

function tempStore(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seat-grant-"));
  tempDirs.push(dir);
  return path.join(dir, "grants.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("setModelGrant mergeMode", () => {
  it("replace overwrites the prior active set", async () => {
    const storePath = tempStore();
    await setModelGrant(
      {
        tenantId: "t1",
        subjectType: "seat",
        subjectId: "s1",
        grantedModelIds: ["a/x", "b/y"],
      },
      storePath,
    );
    const next = await setModelGrant(
      {
        tenantId: "t1",
        subjectType: "seat",
        subjectId: "s1",
        grantedModelIds: ["c/z"],
        mergeMode: "replace",
      },
      storePath,
    );
    expect(next.grantedModelIds).toEqual(["c/z"]);
  });

  it("union merges into the prior active set", async () => {
    const storePath = tempStore();
    await setModelGrant(
      {
        tenantId: "t1",
        subjectType: "seat",
        subjectId: "s1",
        grantedModelIds: ["a/x", "b/y"],
      },
      storePath,
    );
    const next = await setModelGrant(
      {
        tenantId: "t1",
        subjectType: "seat",
        subjectId: "s1",
        grantedModelIds: ["c/z"],
        mergeMode: "union",
      },
      storePath,
    );
    expect(next.grantedModelIds.toSorted()).toEqual(["a/x", "b/y", "c/z"]);
  });
});

describe("setModelGrantsAtomic", () => {
  it("writes multiple seats in one transaction", async () => {
    const storePath = tempStore();
    await setModelGrant(
      {
        tenantId: "t1",
        subjectType: "seat",
        subjectId: "s1",
        grantedModelIds: ["legacy/keep"],
      },
      storePath,
    );
    const grants = await setModelGrantsAtomic(
      {
        tenantId: "t1",
        items: [
          {
            subjectType: "seat",
            subjectId: "s1",
            grantedModelIds: ["ent/new"],
            mergeMode: "union",
          },
          {
            subjectType: "seat",
            subjectId: "s2",
            grantedModelIds: ["ent/new"],
            mergeMode: "union",
          },
        ],
      },
      storePath,
    );
    expect(grants).toHaveLength(2);
    const s1 = await getModelGrant(
      { tenantId: "t1", subjectType: "seat", subjectId: "s1" },
      storePath,
    );
    const s2 = await getModelGrant(
      { tenantId: "t1", subjectType: "seat", subjectId: "s2" },
      storePath,
    );
    expect(s1?.grantedModelIds.toSorted()).toEqual(["ent/new", "legacy/keep"]);
    expect(s2?.grantedModelIds).toEqual(["ent/new"]);
  });

  it("does not leave partial writes when validation fails before save", async () => {
    const storePath = tempStore();
    await setModelGrant(
      {
        tenantId: "t1",
        subjectType: "seat",
        subjectId: "s1",
        grantedModelIds: ["keep/me"],
      },
      storePath,
    );
    await expect(
      setModelGrantsAtomic(
        {
          tenantId: "t1",
          items: [
            {
              subjectType: "seat",
              subjectId: "s1",
              grantedModelIds: ["ent/new"],
              mergeMode: "union",
            },
            {
              subjectType: "seat",
              subjectId: "  ",
              grantedModelIds: ["ent/new"],
              mergeMode: "union",
            },
          ],
        },
        storePath,
      ),
    ).rejects.toThrow(/invalid subjectId/);
    const s1 = await getModelGrant(
      { tenantId: "t1", subjectType: "seat", subjectId: "s1" },
      storePath,
    );
    expect(s1?.grantedModelIds).toEqual(["keep/me"]);
  });
});
