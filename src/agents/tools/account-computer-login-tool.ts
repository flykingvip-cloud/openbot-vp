import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const LoginToolSchema = Type.Object({
  action: Type.String({ description: "plan | offer_save" }),
  host: Type.Optional(Type.String()),
  signals: Type.Optional(
    Type.Object({
      signedIn: Type.Optional(Type.Boolean()),
      password: Type.Optional(Type.Boolean()),
      qr: Type.Optional(Type.Boolean()),
      captcha: Type.Optional(Type.Boolean()),
      passkey: Type.Optional(Type.Boolean()),
    }),
  ),
  domain: Type.Optional(
    Type.Object({
      host: Type.Optional(Type.String()),
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
  timeoutMs: Type.Optional(Type.Number()),
});

const DEFAULT_WAIT_MS = 180_000;

/**
 * Login routing for the Account Computer. The tool never accepts or returns
 * usernames, passwords, or vault plaintext.
 */
export function createAccountComputerLoginTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Account Computer Login",
    name: "account_computer_login",
    description: [
      "Decide how to log in on the Account Computer without seeing passwords.",
      "action=plan: after a snapshot, pass host and signals {signedIn, password, qr, captcha, passkey}. Field refs are optional and must not include values.",
      "plan returns continue, secure_form, handoff, autofill, or autofill_needs_fields. Password plus QR on a first visit waits for the user's one-time choice.",
      "When plan returns secure_form, call secure_form action=request. When it returns handoff, call secure_form action=handoff then await_return.",
      "When plan returns autofill_needs_fields, call plan again with field refs only. status filled means the vault filled the page.",
      "action=offer_save: after a user-typed secure_form fill and a signed-in snapshot, ask once whether to save that site. Skip this when plan autofilled.",
      "Do not ask the user to type a password or SMS code in chat. Do not guess a QR login when password fields are visible.",
    ].join(" "),
    parameters: LoginToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const sessionKey = opts?.agentSessionKey?.trim();
      if (!sessionKey) {
        throw new Error("account_computer_login requires agent sessionKey");
      }
      const waitMs =
        typeof params.timeoutMs === "number" && params.timeoutMs > 0
          ? Math.floor(params.timeoutMs)
          : DEFAULT_WAIT_MS;
      if (action === "plan") {
        const result = await callGatewayTool(
          "account_computer_login.plan",
          { timeoutMs: waitMs + 10_000 },
          {
            sessionKey,
            host: params.host,
            signals: params.signals,
            domain: params.domain,
            fields: params.fields,
            timeoutMs: waitMs,
          },
        );
        return jsonResult(result);
      }
      if (action === "offer_save") {
        const result = await callGatewayTool(
          "account_computer_login.offer_save",
          { timeoutMs: waitMs + 10_000 },
          {
            sessionKey,
            host: params.host,
            timeoutMs: waitMs,
          },
        );
        return jsonResult(result);
      }
      throw new Error(`Unknown account_computer_login action: ${action}`);
    },
  };
}
