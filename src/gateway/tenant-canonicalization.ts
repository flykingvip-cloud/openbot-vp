import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";
import { stringValue } from "./records.js";

const CANONICAL_TENANT_IDS = {
  upbeyond: "001",
} as const;

const LEGACY_TENANT_ID_ALIASES: Record<string, string> = {
  "upbeyond-91aeea3c": CANONICAL_TENANT_IDS.upbeyond,
};

export function canonicalizeTenantId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return LEGACY_TENANT_ID_ALIASES[trimmed] ?? trimmed;
}

export function canonicalizeTenantIdList(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const canonical = canonicalizeTenantId(value);
    if (!canonical || seen.has(canonical)) {
      continue;
    }
    seen.add(canonical);
    result.push(canonical);
  }
  return result;
}

export function findCanonicalTenantIdBySlug(params: {
  slug?: string | null;
  tenantsPath?: string | null;
}): string | null {
  const slug = params.slug?.trim().toLowerCase();
  if (!slug) {
    return null;
  }
  if (slug in CANONICAL_TENANT_IDS) {
    return CANONICAL_TENANT_IDS[slug as keyof typeof CANONICAL_TENANT_IDS];
  }
  const tenantsPath = resolveUserPath(
    params.tenantsPath?.trim() || path.join(CONFIG_DIR, "enterprise", "tenants.json"),
  );
  try {
    const raw = fs.readFileSync(tenantsPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      tenants?: Array<{ slug?: string; id?: string }>;
    };
    return (
      stringValue(
        parsed.tenants?.find((entry) => entry?.slug?.trim().toLowerCase() === slug)?.id,
      ) ?? null
    );
  } catch {
    return null;
  }
}
