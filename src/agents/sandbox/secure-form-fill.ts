import type { PendingSecureForm } from "./secure-form-store.js";
import type { SecureFormFailureCode, SecureFormReceipt } from "./secure-form-types.js";

export type SecureFormPageContext = {
  hostname: string;
  href: string;
};

export type SecureFormFillDeps = {
  /** Read live page URL from the account sandbox browser (CDP). */
  readPage: (account: {
    tenantId: string;
    userId: string;
  }) => Promise<SecureFormPageContext | null>;
  /**
   * Write values into targets. Must never log or return the values.
   * Returns per-fieldId ok flags only.
   */
  fillFields: (params: {
    tenantId: string;
    userId: string;
    fields: Array<{ fieldId: string; ref?: string; selector?: string }>;
    /** opaque bag — fill impl must zeroize after use */
    values: Record<string, string>;
    submitAfterFill?: boolean;
  }) => Promise<{
    ok: boolean;
    code?: SecureFormFailureCode;
    detail?: string;
    submittedEnter?: boolean;
    missingFieldIds?: string[];
  }>;
};

const defaultDeps: SecureFormFillDeps = {
  async readPage() {
    return null;
  },
  async fillFields() {
    return { ok: false, code: "browser_unavailable", detail: "fill host not wired" };
  },
};

let deps: SecureFormFillDeps = defaultDeps;

/** Production wiring (and tests that need a real override without the ForTests alias). */
export function setSecureFormFillDeps(next: SecureFormFillDeps | null) {
  deps = next ?? defaultDeps;
}

export function setSecureFormFillDepsForTests(next: SecureFormFillDeps | null) {
  setSecureFormFillDeps(next);
}

export function getSecureFormFillDepsForTests(): SecureFormFillDeps {
  return deps;
}

function hostAllowed(hostname: string, form: PendingSecureForm): boolean {
  const host = hostname.trim().toLowerCase();
  const bare = host.startsWith("www.") ? host.slice(4) : host;
  const expected = form.domain.host;
  const expectedBare = expected.startsWith("www.") ? expected.slice(4) : expected;
  if (bare === expectedBare) {
    return true;
  }
  const aliases = form.domain.allowHosts ?? [];
  for (const a of aliases) {
    const ab = a.startsWith("www.") ? a.slice(4) : a;
    if (bare === ab) {
      return true;
    }
  }
  return false;
}

/**
 * Preflight + fill. `values` is zeroized by clearing keys after the call returns.
 * Callers must not retain the values object.
 */
export async function preflightAndFillSecureForm(params: {
  form: PendingSecureForm;
  values: Record<string, string>;
}): Promise<SecureFormReceipt> {
  const { form } = params;
  const values = params.values;
  try {
    const page = await deps.readPage({ tenantId: form.tenantId, userId: form.userId });
    if (!page) {
      return {
        formId: form.formId,
        status: "failed",
        code: "browser_unavailable",
        completedAt: Date.now(),
      };
    }
    if (!hostAllowed(page.hostname, form)) {
      return {
        formId: form.formId,
        status: "failed",
        code: "domain_mismatch",
        detail: `page host ${page.hostname}`,
        completedAt: Date.now(),
      };
    }
    for (const field of form.fields) {
      if (!field.ref && !field.selector) {
        return {
          formId: form.formId,
          status: "failed",
          code: "target_not_found",
          detail: field.fieldId,
          completedAt: Date.now(),
        };
      }
      if (values[field.fieldId] == null && field.required !== false) {
        return {
          formId: form.formId,
          status: "failed",
          code: "fill_error",
          detail: `missing ${field.fieldId}`,
          completedAt: Date.now(),
        };
      }
    }
    const result = await deps.fillFields({
      tenantId: form.tenantId,
      userId: form.userId,
      fields: form.fields.map((f) => ({
        fieldId: f.fieldId,
        ...(f.ref ? { ref: f.ref } : {}),
        ...(f.selector ? { selector: f.selector } : {}),
      })),
      values,
      submitAfterFill: form.submitAfterFill,
    });
    if (!result.ok) {
      return {
        formId: form.formId,
        status: "failed",
        code: result.code ?? "fill_error",
        ...(result.detail ? { detail: result.detail } : {}),
        completedAt: Date.now(),
      };
    }
    return {
      formId: form.formId,
      status: "filled",
      completedAt: Date.now(),
      ...(typeof result.submittedEnter === "boolean"
        ? { submittedEnter: result.submittedEnter }
        : {}),
    };
  } finally {
    for (const key of Object.keys(values)) {
      values[key] = "";
      delete values[key];
    }
  }
}
