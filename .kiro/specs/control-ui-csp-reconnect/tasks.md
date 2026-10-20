# Control UI CSP and unauthenticated reconnect gating

## Agents

- cursor-grok · role: owner · scope: Control UI media-src CSP plus AUTH_TRUSTED_PROXY_USER_MISSING reconnect regression · paths: `src/gateway/control-ui-csp.ts`, `src/gateway/control-ui-csp.test.ts`, `src/gateway/reconnect-gating.test.ts`, `ui/src/ui/gateway.ts`, `ui/src/ui/gateway.node.test.ts`, `ui/src/ui/app-gateway.ts`, `ui/src/ui/app-gateway.node.test.ts`, `ui/src/ui/capability/gateway/runtime.ts`, `ui/src/ui/routing/openbot-subdomain-redirect.ts`, `ui/src/ui/routing/openbot-subdomain-redirect.node.test.ts`, `ui/src/ui/storage.ts`, `.kiro/specs/control-ui-csp-reconnect/**` · since: 2026-09-14

## Tasks

- [x] Add `media-src 'self' blob: data:` to Control UI CSP with regression tests. — cursor-grok
- [x] Confirm AUTH_TRUSTED_PROXY_USER_MISSING is non-recoverable and does not schedule reconnect. — cursor-grok
- [x] Keep 1006/1012 transport reconnect and existing auth-error behavior. — cursor-grok
- [x] Wire existing preferred-gateway URL recovery on first connect and onReconnectUrl without changing transport retry policy. — cursor-grok
