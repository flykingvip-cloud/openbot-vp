# Preserve login surface membership

## Agents

- codex-kb-review · role: owner · scope: forward authenticated login membership through reply and session-store adapters · paths: src/gateway/tenant-context*, src/auto-reply/reply/dispatch-from-config.ts, src/auto-reply/reply/session.ts, .kiro/specs/login-scope-propagation/** · since: 2026-11-23

- [x] Root cause: dispatchReplyFromConfig and resolveSessionStorePathForInboundMessage reconstructed clients without the exact enterprise/membership pair already supplied by chat.send. The unique-membership fallback rejects dual-role accounts. Preserve the selected login scope, never first-match roles or trust tenant hints. — codex-kb-review
- [x] 306 relevant tests, scoped lint and full tsgo passed. Real-service retest pending. — codex-kb-review
