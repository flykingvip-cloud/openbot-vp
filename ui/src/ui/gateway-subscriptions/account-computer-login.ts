/**
 * Account Computer login cards — method choice and opt-in save.
 * Payloads never include credentials.
 */

import type { GatewayHost } from "../gateway-host.ts";
import type { GatewayEventFrame } from "../gateway.ts";

export type LoginMethodChoiceUi = {
  choiceId: string;
  sessionKey: string;
  host: string;
  methods: Array<"password" | "qr">;
};

export type LoginSaveOfferUi = {
  saveId: string;
  sessionKey: string;
  host: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function parseLoginMethodChoice(payload: unknown): LoginMethodChoiceUi | null {
  if (!isRecord(payload)) {
    return null;
  }
  const choiceId = typeof payload.choiceId === "string" ? payload.choiceId.trim() : "";
  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey.trim() : "";
  const host = typeof payload.host === "string" ? payload.host.trim() : "";
  const methodsRaw = payload.methods;
  if (!choiceId || !sessionKey || !host || !Array.isArray(methodsRaw)) {
    return null;
  }
  const methods = methodsRaw.filter(
    (method): method is "password" | "qr" => method === "password" || method === "qr",
  );
  if (methods.length === 0) {
    return null;
  }
  return { choiceId, sessionKey, host, methods };
}

export function parseLoginSaveOffer(payload: unknown): LoginSaveOfferUi | null {
  if (!isRecord(payload)) {
    return null;
  }
  const saveId = typeof payload.saveId === "string" ? payload.saveId.trim() : "";
  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey.trim() : "";
  const host = typeof payload.host === "string" ? payload.host.trim() : "";
  if (!saveId || !sessionKey || !host) {
    return null;
  }
  return { saveId, sessionKey, host };
}

function eventId(payload: unknown, key: "choiceId" | "saveId"): string {
  if (!isRecord(payload)) {
    return "";
  }
  return typeof payload[key] === "string" ? payload[key].trim() : "";
}

export type AccountComputerLoginGatewayHost = GatewayHost & {
  sessionKey: string;
  loginMethodChoice: LoginMethodChoiceUi | null;
  loginSaveOffer: LoginSaveOfferUi | null;
  loginCardBusy: boolean;
  loginCardError: string | null;
};

export function handleAccountComputerLoginGatewayEvent(
  host: GatewayHost,
  evt: GatewayEventFrame,
): boolean {
  const h = host as AccountComputerLoginGatewayHost;
  if (evt.event === "account_computer_login.choice_offered") {
    const choice = parseLoginMethodChoice(evt.payload);
    if (!choice || (h.sessionKey && choice.sessionKey !== h.sessionKey)) {
      return true;
    }
    h.loginMethodChoice = choice;
    h.loginCardError = null;
    return true;
  }
  if (evt.event === "account_computer_login.choice_resolved") {
    const choiceId = eventId(evt.payload, "choiceId");
    if (choiceId && h.loginMethodChoice?.choiceId === choiceId) {
      h.loginMethodChoice = null;
    }
    return true;
  }
  if (evt.event === "account_computer_login.save_offered") {
    const offer = parseLoginSaveOffer(evt.payload);
    if (!offer || (h.sessionKey && offer.sessionKey !== h.sessionKey)) {
      return true;
    }
    h.loginSaveOffer = offer;
    h.loginCardError = null;
    return true;
  }
  if (evt.event === "account_computer_login.save_resolved") {
    const saveId = eventId(evt.payload, "saveId");
    if (saveId && h.loginSaveOffer?.saveId === saveId) {
      h.loginSaveOffer = null;
    }
    return true;
  }
  return false;
}
