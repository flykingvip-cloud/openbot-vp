/**
 * Shared parent-scoped contextScope fixtures for browser + gateway E2E.
 * Keep one source of truth so both layers cannot drift into a false pass.
 */

export const CONTEXT_SCOPE_TYPED_FILE = {
  mode: "focused" as const,
  lifetime: "turn" as const,
  sources: [
    {
      type: "file" as const,
      id: "doc-roadmap",
      parentId: "kb-product",
    },
  ],
};

/** Same file id without parent — protocol must forward as-is (authorize fails closed elsewhere). */
export const CONTEXT_SCOPE_PARENTLESS_FILE = {
  mode: "focused" as const,
  lifetime: "turn" as const,
  sources: [
    {
      type: "file" as const,
      id: "doc-roadmap",
    },
  ],
};

export const CONTEXT_SCOPE_CHAT_MESSAGE = "只看产品路线图";

export type ChatSendContextScopePayload = {
  sessionKey: string;
  message: string;
  deliver: false;
  idempotencyKey: string;
  contextScope: typeof CONTEXT_SCOPE_TYPED_FILE | typeof CONTEXT_SCOPE_PARENTLESS_FILE;
};

/** UI-aligned chat.send body (matches ui/src/ui/controllers/chat.ts). */
export function buildChatSendUiPayload(params: {
  sessionKey?: string;
  message?: string;
  idempotencyKey: string;
  contextScope?: typeof CONTEXT_SCOPE_TYPED_FILE | typeof CONTEXT_SCOPE_PARENTLESS_FILE;
}): ChatSendContextScopePayload {
  return {
    sessionKey: params.sessionKey ?? "main",
    message: params.message ?? CONTEXT_SCOPE_CHAT_MESSAGE,
    deliver: false,
    idempotencyKey: params.idempotencyKey,
    contextScope: params.contextScope ?? CONTEXT_SCOPE_TYPED_FILE,
  };
}

export function expectTypedFileParentScope(
  contextScope: unknown,
): asserts contextScope is typeof CONTEXT_SCOPE_TYPED_FILE {
  const scope = contextScope as typeof CONTEXT_SCOPE_TYPED_FILE | null | undefined;
  if (
    !scope ||
    scope.mode !== "focused" ||
    scope.lifetime !== "turn" ||
    !Array.isArray(scope.sources) ||
    scope.sources.length !== 1 ||
    scope.sources[0]?.type !== "file" ||
    scope.sources[0]?.id !== "doc-roadmap" ||
    scope.sources[0]?.parentId !== "kb-product"
  ) {
    throw new Error(
      `expected typed parent-scoped contextScope, got ${JSON.stringify(contextScope)}`,
    );
  }
}
