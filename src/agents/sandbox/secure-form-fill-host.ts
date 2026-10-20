/**
 * Production Secure Form CDP fill host.
 *
 * Resolves the account sandbox browser CDP via the in-process account CDP
 * port map / browser bridge, then fills via Playwright (ref preferred, then
 * selector). Never logs field values.
 */
import { getPageForTargetId, refLocator } from "../../browser/pw-session.js";
import { typeViaPlaywright } from "../../browser/pw-tools-core.interactions.js";
import { resolveAccountBrowserCdpUrl } from "./account-cdp-resolve.js";
import {
  setSecureFormFillDeps,
  type SecureFormFillDeps,
  type SecureFormPageContext,
} from "./secure-form-fill.js";
import type { SecureFormFailureCode } from "./secure-form-types.js";

function zeroizeValues(values: Record<string, string>) {
  for (const key of Object.keys(values)) {
    values[key] = "";
    delete values[key];
  }
}

export function createSecureFormFillDeps(): SecureFormFillDeps {
  return {
    async readPage(account): Promise<SecureFormPageContext | null> {
      const cdpUrl = await resolveAccountBrowserCdpUrl(account);
      if (!cdpUrl) {
        return null;
      }
      try {
        const page = await getPageForTargetId({ cdpUrl });
        const href = page.url();
        let hostname = "";
        try {
          hostname = new URL(href).hostname.toLowerCase();
        } catch {
          return null;
        }
        if (!hostname) {
          return null;
        }
        return { hostname, href };
      } catch {
        return null;
      }
    },

    async fillFields(params) {
      const cdpUrl = await resolveAccountBrowserCdpUrl({
        tenantId: params.tenantId,
        userId: params.userId,
      });
      if (!cdpUrl) {
        zeroizeValues(params.values);
        return { ok: false, code: "browser_unavailable" as SecureFormFailureCode };
      }
      try {
        const page = await getPageForTargetId({ cdpUrl });
        for (const field of params.fields) {
          const value = params.values[field.fieldId] ?? "";
          try {
            if (field.ref?.trim()) {
              // Prefer fill (not slow type) so passwords are set atomically.
              await typeViaPlaywright({
                cdpUrl,
                ref: field.ref.trim(),
                text: value,
                slowly: false,
              });
            } else if (field.selector?.trim()) {
              const locator = page.locator(field.selector.trim()).first();
              await locator.fill(value, { timeout: 8000 });
            } else {
              return {
                ok: false,
                code: "target_not_found" as SecureFormFailureCode,
                detail: field.fieldId,
                missingFieldIds: [field.fieldId],
              };
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : "fill failed";
            const notFound =
              /not found|no node|unknown ref|timeout/i.test(message) ||
              message.includes("strict mode violation");
            return {
              ok: false,
              code: (notFound ? "target_not_found" : "fill_error") as SecureFormFailureCode,
              detail: field.fieldId,
              missingFieldIds: notFound ? [field.fieldId] : undefined,
            };
          }
        }

        let submittedEnter = false;
        if (params.submitAfterFill && params.fields.length > 0) {
          const last = params.fields[params.fields.length - 1];
          try {
            if (last?.ref?.trim()) {
              await refLocator(page, last.ref.trim()).press("Enter", { timeout: 8000 });
              submittedEnter = true;
            } else if (last?.selector?.trim()) {
              await page.locator(last.selector.trim()).first().press("Enter", { timeout: 8000 });
              submittedEnter = true;
            }
          } catch {
            // Enter is best-effort; fill already succeeded.
            submittedEnter = false;
          }
        }
        return { ok: true, submittedEnter };
      } catch {
        return { ok: false, code: "browser_unavailable" as SecureFormFailureCode };
      } finally {
        zeroizeValues(params.values);
      }
    },
  };
}

let wired = false;

/** Idempotent production wiring — call from gateway secure-form module load. */
export function ensureSecureFormFillHostWired(): void {
  if (wired) {
    return;
  }
  setSecureFormFillDeps(createSecureFormFillDeps());
  wired = true;
}

/** Test hook so unit tests can re-wire / reset the once-flag. */
export function resetSecureFormFillHostWiredForTests(): void {
  wired = false;
}
