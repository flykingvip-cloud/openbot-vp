import { expect } from "vitest";
import {
  CONTEXT_SCOPE_PARENTLESS_FILE,
  CONTEXT_SCOPE_TYPED_FILE,
  expectTypedFileParentScope,
} from "./chat-context-scope-fixtures.js";

type DispatchCall = {
  replyOptions?: {
    contextScopeRequest?: unknown;
  };
};

export function expectDispatchTypedParentScope(mock: { mock: { calls: unknown[][] } }): void {
  expect(mock.mock.calls.length).toBeGreaterThan(0);
  const matching = mock.mock.calls.find((call) => {
    const params = call[0] as DispatchCall | undefined;
    const scope = params?.replyOptions?.contextScopeRequest;
    try {
      expectTypedFileParentScope(scope);
      return true;
    } catch {
      return false;
    }
  });
  expect(matching, "dispatch never received typed parent-scoped contextScopeRequest").toBeTruthy();
  const params = matching![0] as DispatchCall;
  expect(params.replyOptions?.contextScopeRequest).toEqual(CONTEXT_SCOPE_TYPED_FILE);
}

export function expectDispatchParentlessFileScope(mock: { mock: { calls: unknown[][] } }): void {
  expect(mock.mock.calls.length).toBeGreaterThan(0);
  const matching = mock.mock.calls.find((call) => {
    const params = call[0] as DispatchCall | undefined;
    return (
      JSON.stringify(params?.replyOptions?.contextScopeRequest) ===
      JSON.stringify(CONTEXT_SCOPE_PARENTLESS_FILE)
    );
  });
  expect(matching, "dispatch never received parentless contextScopeRequest").toBeTruthy();
  const params = matching![0] as DispatchCall;
  const scope = params.replyOptions?.contextScopeRequest as {
    sources?: Array<{ parentId?: string }>;
  };
  expect(scope.sources?.[0]?.parentId).toBeUndefined();
}
