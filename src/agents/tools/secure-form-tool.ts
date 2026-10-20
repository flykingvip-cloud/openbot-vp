import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const SecureFormToolSchema = Type.Object({
  action: Type.String({
    description: "request | cancel | handoff | await_return | remap",
  }),
  reason: Type.Optional(Type.String()),
  domain: Type.Optional(
    Type.Object({
      host: Type.String(),
      allowHosts: Type.Optional(Type.Array(Type.String())),
      expectedUrlPrefix: Type.Optional(Type.String()),
    }),
  ),
  fields: Type.Optional(
    Type.Array(
      Type.Object({
        fieldId: Type.String(),
        kind: Type.String(),
        label: Type.String(),
        ref: Type.Optional(Type.String()),
        selector: Type.Optional(Type.String()),
        accessibleName: Type.Optional(Type.String()),
        required: Type.Optional(Type.Boolean()),
      }),
    ),
  ),
  formId: Type.Optional(Type.String()),
  submitAfterFill: Type.Optional(Type.Boolean()),
  hint: Type.Optional(Type.String()),
  instruction: Type.Optional(Type.String()),
  relatedFormId: Type.Optional(Type.String()),
  handoffReason: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
});

/**
 * Agent-facing Secure Form tool. Never accepts or returns field values.
 * UI submits secrets via Gateway `secure_form.submit` only.
 */
export function createSecureFormTool(opts?: {
  agentSessionKey?: string;
  agentLabel?: string;
}): AnyAgentTool {
  return {
    label: "Secure Form",
    name: "secure_form",
    description: [
      "Request an in-chat Secure Form for username/password/otp on the account computer browser.",
      "On a login page, call account_computer_login action=plan first. Use this tool when plan returns secure_form, or handoff when plan returns handoff.",
      "You never see field values — only filled/failed receipts.",
      "Do not use browser act type/fill for password or otp.",
      "After filled, snapshot then click the site submit control (unless OTP used submitAfterFill).",
      "For QR/SMS/SSO/passkey/captcha/slider gates use action=handoff (omit instruction — server uses the short default). Handoff for those reasons parks mid-task (awaits login) — not task completion. In chat emit EXACTLY once before or with handoff: 「请在云电脑窗口扫码或输入短信验证码；完成后系统会自动继续。」 Do not narrate snapshot/page-state or list login methods; no second paraphrase; no AI接管 status; no 不用点/无需点「交给AI」. The system auto-resumes with auto_gate_cleared when signed-in; do not require「交给AI」.",
    ].join(" "),
    parameters: SecureFormToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const sessionKey = opts?.agentSessionKey?.trim();
      if (!sessionKey) {
        throw new Error("secure_form requires agent sessionKey");
      }
      if (action === "request") {
        const result = await callGatewayTool(
          "secure_form.request",
          {},
          {
            sessionKey,
            agentLabel: opts?.agentLabel ?? "Agent",
            reason: params.reason ?? "auth",
            domain: params.domain,
            fields: params.fields,
            submitAfterFill: params.submitAfterFill === true,
            hint: params.hint,
          },
        );
        return jsonResult(result);
      }
      if (action === "cancel") {
        const result = await callGatewayTool(
          "secure_form.cancel",
          {},
          {
            formId: params.formId,
            sessionKey,
            code: params.code ?? "user_declined",
          },
        );
        return jsonResult(result);
      }
      if (action === "remap") {
        const result = await callGatewayTool(
          "secure_form.remap",
          {},
          {
            formId: params.formId,
            fields: params.fields,
          },
        );
        return jsonResult(result);
      }
      if (action === "handoff") {
        const reason =
          (typeof params.handoffReason === "string" && params.handoffReason.trim()) ||
          (typeof params.reason === "string" && params.reason.trim()) ||
          "user_takeover";
        const result = await callGatewayTool(
          "secure_form.handoff",
          {},
          {
            sessionKey,
            reason,
            instruction: params.instruction,
            relatedFormId: params.relatedFormId ?? params.formId,
          },
        );
        // Mid-task park: QR/SMS (and similar) gates auto-await so the run stays
        // waiting — not finished — until auto_gate_cleared or explicit handback.
        const parkReasons = new Set(["qr", "sms", "captcha", "passkey", "slider", "sso"]);
        const statusRaw =
          result && typeof result === "object" && "status" in result
            ? (result as { status?: unknown }).status
            : undefined;
        const status = typeof statusRaw === "string" ? statusRaw : "";
        if (parkReasons.has(reason) && status === "handoff_active") {
          const waited = await callGatewayTool(
            "secure_form.await_return",
            {},
            {
              sessionKey,
              ...(typeof params.timeoutMs === "number" ? { timeoutMs: params.timeoutMs } : {}),
            },
          );
          return jsonResult({
            ...(typeof result === "object" && result ? result : { handoff: result }),
            await_return: waited,
            mid_wait: true,
          });
        }
        return jsonResult(result);
      }
      if (action === "await_return") {
        const result = await callGatewayTool(
          "secure_form.await_return",
          {},
          {
            sessionKey,
            ...(typeof params.timeoutMs === "number" ? { timeoutMs: params.timeoutMs } : {}),
          },
        );
        return jsonResult(result);
      }
      throw new Error(`Unknown secure_form action: ${action}`);
    },
  };
}
