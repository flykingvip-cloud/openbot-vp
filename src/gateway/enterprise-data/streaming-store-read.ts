/** Read-only legacy JSON projection. Skipped sections are never assembled. */
import fs from "node:fs";
import { createRequire } from "node:module";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { normalizeEnterpriseDataStore, resolveDefaultEnterpriseDataStorePath } from "./store.js";
import type { EnterpriseDataStore } from "./types.js";

const require = createRequire(import.meta.url);
const { parser } = require("stream-json") as {
  parser: (opts: Record<string, boolean>) => Transform;
};
const { filter } = require("stream-json/filters/Filter") as {
  filter: (opts: { filter: RegExp; streamKeys: boolean }) => Transform;
};
const { streamValues } = require("stream-json/streamers/StreamValues") as {
  streamValues: () => Transform;
};

// Consumption needs catalog/visibility/feed metadata, not invocation logs, audit
// histories, credentials, classification paths, or connector sync snapshots.
export const KNOWLEDGE_READ_SECTIONS = [
  "version",
  "dataSources",
  "dataCapabilities",
  "dataAccessPolicies",
  "seatActionGrants",
  "enterpriseKnowledgeProjectionSpecs",
  "enterpriseKnowledgeProjectionBindings",
  "knowledgeVisibilityPolicies",
  "knowledgeFeedItems",
  "knowledgeLineageRecords",
] as const;
const sectionFilter = new RegExp(`^(?:${KNOWLEDGE_READ_SECTIONS.join("|")})(?:\\.|$)`);
const MAX_SELECTED_BYTES = 32 * 1024 * 1024;

export async function readKnowledgeEnterpriseStore(input: {
  storePath?: string;
  tenantId: string | null;
  maxSelectedBytes?: number;
}): Promise<EnterpriseDataStore> {
  if (!input.tenantId) {
    return normalizeEnterpriseDataStore(null);
  }
  let selectedBytes = 0;
  let result: Partial<EnterpriseDataStore> | undefined;
  const budget = input.maxSelectedBytes ?? MAX_SELECTED_BYTES;
  let stringParts: string[] | undefined;
  const meter = new Transform({
    objectMode: true,
    transform(raw: unknown, _encoding, callback) {
      const token = raw as { name: string; value?: unknown };
      if (token.name === "keyValue" && token.value === "__proto__") {
        callback(new Error("knowledge_read_unsafe_object_key"));
        return;
      }
      selectedBytes += typeof token.value === "string" ? Buffer.byteLength(token.value) : 8;
      if (selectedBytes > budget) {
        return callback(new Error("knowledge_read_projection_budget_exceeded"));
      }
      // Pack strings only after section filtering and budget enforcement.
      if (token.name === "startString") {
        stringParts = [];
        callback();
      } else if (token.name === "stringChunk" && stringParts) {
        stringParts.push(String(token.value));
        callback();
      } else if (token.name === "endString" && stringParts) {
        const value = stringParts.join("");
        stringParts = undefined;
        callback(null, { name: "stringValue", value });
      } else {
        callback(null, raw);
      }
    },
  });
  try {
    await pipeline(
      fs.createReadStream(input.storePath ?? resolveDefaultEnterpriseDataStorePath(), {
        highWaterMark: 64 * 1024,
      }),
      parser({
        packKeys: true,
        streamKeys: false,
        packStrings: false,
        streamStrings: true,
        packNumbers: true,
        streamNumbers: false,
      }),
      filter({ filter: sectionFilter, streamKeys: false }),
      meter,
      streamValues(),
      new Writable({
        objectMode: true,
        write(raw: unknown, _encoding, callback) {
          const value = (raw as { value: Partial<EnterpriseDataStore> }).value;
          result = value;
          callback();
        },
      }),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return normalizeEnterpriseDataStore(null);
    }
    throw error;
  }
  // The caller resolved an authorized tenant path. Also reject cross-tenant rows
  // before normal consumers build any feed, capability or prompt projection.
  const scoped: Record<string, unknown> = {};
  for (const key of KNOWLEDGE_READ_SECTIONS) {
    if (key === "version") {
      continue;
    }
    const values = result?.[key];
    if (values && typeof values === "object") {
      scoped[key] = Object.fromEntries(
        Object.entries(values).filter(
          ([, row]) =>
            row && typeof row === "object" && "tenantId" in row && row.tenantId === input.tenantId,
        ),
      );
    }
  }
  return normalizeEnterpriseDataStore(scoped as Partial<EnterpriseDataStore>);
}
