import { describe, expect, it } from "vitest";
import type { TranslationMap } from "../../i18n/lib/types.ts";
import { en } from "../../i18n/locales/en.ts";
import { zh_CN } from "../../i18n/locales/zh-CN.ts";

/**
 * Task 1.9 (embed side) — overview / me embed i18n consistency (zh-CN + en).
 *
 * The employee embed surfaces render from these key namespaces:
 *   - overview (home / assistant module): `frontstage.*`, `common.*`, `nav.*`
 *   - me (personal settings module):      `frontstage.workbench.*`, `common.*`
 *   - shared chrome / auth entry:         `chat.*`, `authHome.*`
 *
 * `I18nManager.t()` silently falls back to English when a key is missing in the
 * active locale — which surfaces as MIXED-LANGUAGE UI on a zh-CN device (and a
 * raw dotted key when English is the one missing). This test locks byte-level
 * KEY parity (both directions) for the namespaces the embed consumes, so neither
 * kind of drift can slip into the internal beta.
 *
 * `overview.platformAuth.*` is intentionally excluded: that subtree is the
 * PLATFORM console's overview (tenant/seat/admin management), owned by the
 * platform port — not the employee embed — and is tracked separately.
 *
 * Co-located with the embed (rather than under `ui/src/i18n/`) because the root
 * vitest config includes `ui/src/ui/**` but not `ui/src/i18n/**`, so a test here
 * actually runs in CI.
 */

/** Namespaces the employee overview/me embed actually render from. */
const EMBED_NAMESPACES = ["frontstage", "common", "nav", "chat", "authHome"] as const;

/** Collect every leaf (string-valued) dotted key path under `obj`. */
function collectLeafKeys(obj: TranslationMap, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      out.push(...collectLeafKeys(value, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function keysForNamespace(all: readonly string[], ns: string): string[] {
  return all.filter((key) => key === ns || key.startsWith(`${ns}.`));
}

const EN_LEAVES = collectLeafKeys(en);
const ZH_LEAVES = collectLeafKeys(zh_CN);
const EN_SET = new Set(EN_LEAVES);
const ZH_SET = new Set(ZH_LEAVES);

describe("embed i18n parity (overview / me · zh-CN <-> en)", () => {
  for (const ns of EMBED_NAMESPACES) {
    describe(`namespace "${ns}"`, () => {
      it("is non-empty (guards against a renamed/removed namespace)", () => {
        expect(keysForNamespace(EN_LEAVES, ns).length).toBeGreaterThan(0);
      });

      it("has every English key translated in zh-CN (no English fallback)", () => {
        const missingInZh = keysForNamespace(EN_LEAVES, ns).filter((key) => !ZH_SET.has(key));
        expect(missingInZh, `missing in zh-CN.ts:\n${missingInZh.join("\n")}`).toEqual([]);
      });

      it("has every zh-CN key present in en (no raw-key display on English)", () => {
        const missingInEn = keysForNamespace(ZH_LEAVES, ns).filter((key) => !EN_SET.has(key));
        expect(missingInEn, `missing in en.ts:\n${missingInEn.join("\n")}`).toEqual([]);
      });
    });
  }
});
