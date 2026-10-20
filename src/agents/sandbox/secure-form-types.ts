/** Account Computer P5a Secure Form shared types (no secrets). */

export type SecureFormReason = "auth" | "otp" | "challenge";

export type SecureFormFieldKind = "username" | "password" | "otp" | "text" | "email";

export type SecureFormFieldTarget = {
  fieldId: string;
  kind: SecureFormFieldKind;
  label: string;
  ref?: string;
  selector?: string;
  accessibleName?: string;
  required?: boolean;
};

export type SecureFormDomainBinding = {
  host: string;
  allowHosts?: string[];
  expectedUrlPrefix?: string;
};

export type SecureFormOffered = {
  formId: string;
  sessionKey: string;
  agentLabel: string;
  reason: SecureFormReason;
  domain: SecureFormDomainBinding;
  fields: SecureFormFieldTarget[];
  submitAfterFill?: boolean;
  hint?: string;
  timeoutMs?: number;
  createdAt: number;
  tenantId: string;
  userId: string;
};

export type SecureFormFailureCode =
  | "user_declined"
  | "user_timeout"
  | "domain_mismatch"
  | "target_not_found"
  | "target_not_editable"
  | "browser_unavailable"
  | "reauth_required"
  | "cancelled_by_takeover"
  | "aborted"
  | "remap_required"
  | "fill_error";

/** Agent/transcript-visible receipt — never includes field values. */
export type SecureFormReceipt = {
  formId: string;
  status: "filled" | "failed";
  code?: SecureFormFailureCode;
  detail?: string;
  remappedFields?: SecureFormFieldTarget[];
  completedAt: number;
  submittedEnter?: boolean;
};

export type SecureFormHandoffReason =
  | "sso"
  | "passkey"
  | "qr"
  | "captcha"
  | "form_refused"
  | "form_failed"
  | "user_takeover"
  | "reauth";
