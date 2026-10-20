import { html, nothing, type TemplateResult } from "lit";

/**
 * Pending cross-person 大白 call.
 * Rendered on the existing steward confirm card (meeting release / collab approve),
 * not as a transcript bubble. Same session history; not a second channel.
 */
export type StewardCallAuthorizationView = {
  id: string;
  prompt: string;
  actions: ["同意", "不同意"];
  roleLabel: string;
};

export type StewardCallAuthorizationDecision = {
  status: "accepted" | "refused";
  authorizationId?: string;
  runId?: string;
  reason?: string;
};

const ACTIONS = ["同意", "不同意"] as const;

export function readStewardCallAuthorization(
  message: unknown,
): StewardCallAuthorizationView | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const raw = (message as { stewardCallAuthorization?: unknown }).stewardCallAuthorization;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
  const actions = row.actions;
  if (!id || !prompt || !Array.isArray(actions) || actions.length !== ACTIONS.length) {
    return null;
  }
  if (actions[0] !== ACTIONS[0] || actions[1] !== ACTIONS[1]) {
    return null;
  }
  return {
    id,
    prompt,
    actions: ["同意", "不同意"],
    roleLabel: typeof row.roleLabel === "string" ? row.roleLabel : "",
  };
}

export function isStewardCallAuthorizationDecision(
  value: unknown,
): value is StewardCallAuthorizationDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as { status?: unknown; reason?: unknown };
  return (
    (row.status === "accepted" && row.reason === "agreed") ||
    (row.status === "refused" && row.reason === "不同意")
  );
}

/**
 * Same chrome as `renderMeetingConfirmationCard` / group-config approve:
 * `employee-workbench__steward-confirm-card`, outside `.chat-group`.
 */
export function renderStewardCallAuthorizationCards(
  messages: unknown[],
  opts: {
    busy?: boolean;
    onDecide?: (action: "同意" | "不同意", authorizationId: string) => void;
  } = {},
): TemplateResult | typeof nothing {
  const pending = messages
    .map((message) => readStewardCallAuthorization(message))
    .filter((row): row is StewardCallAuthorizationView => row !== null);
  if (pending.length === 0) {
    return nothing;
  }
  const busy = Boolean(opts.busy);
  return html`
    ${pending.map(
      (row) => html`
        <div
          class="employee-workbench__assistant-prelude chat-bubble employee-workbench__assistant-prelude-bubble employee-workbench__steward-confirm-card"
          role="group"
          aria-label=${row.prompt}
          data-steward-call-authorization=${row.id}
        >
          <div class="employee-workbench__assistant-prelude-title">${row.prompt}</div>
          <div class="employee-workbench__assistant-prelude-toolbar">
            <button
              type="button"
              class="btn btn--sm primary"
              ?disabled=${busy || !opts.onDecide}
              @click=${() => opts.onDecide?.("同意", row.id)}
            >
              同意
            </button>
            <button
              type="button"
              class="btn btn--sm"
              ?disabled=${busy || !opts.onDecide}
              @click=${() => opts.onDecide?.("不同意", row.id)}
            >
              不同意
            </button>
          </div>
        </div>
      `,
    )}
  `;
}
