# Employee WebSocket Authentication

## Agents

- codex-employee-ws-auth · role: owner · scope: preserve authenticated employee identity from HTTP bootstrap through the WebChat gateway connection · paths: `.kiro/specs/employee-websocket-auth/**`, `ui/src/ui/capability/gateway/runtime.ts`, `ui/src/ui/capability/gateway/runtime.node.test.ts`, `ui/src/ui/controllers/control-ui-bootstrap.ts`, `ui/src/ui/controllers/control-ui-bootstrap.test.ts`, `src/config/types.gateway.ts`, `src/config/zod-schema.ts`, `src/gateway/platform-auth/config.ts`, `src/gateway/platform-auth/auth-helpers.ts`, `src/gateway/platform-auth/routes-auth.ts`, `src/gateway/platform-auth/cookie-domain.test.ts` · since: 2026-08-04

## Tasks

- [x] Reproduce the split state where platform login succeeds but WebSocket chat remains device-authenticated without an employee identity. — codex-employee-ws-auth
- [x] Force authenticated platform sessions onto the current control-ui origin without changing anonymous or remote-gateway behavior. — codex-employee-ws-auth
- [x] Add regression coverage and pass scoped UI tests, formatting, lint, and build. — codex-employee-ws-auth
- [x] Deploy the same-origin connection fix with health, readiness, asset, and rollback evidence. — codex-employee-ws-auth
- [x] Reproduce the remaining split where `platformAuth.session` is present but top-level `authSession` is absent. — codex-employee-ws-auth
- [x] Promote the validated platform session into WebSocket bootstrap state, verify, and deploy. — codex-employee-ws-auth
- [x] Prove the remaining failure is a host-only Cookie boundary rather than a missing membership or source configuration. — codex-employee-ws-auth
- [x] Add an opt-in parent-domain platform Cookie with symmetric logout and security regression coverage. — codex-employee-ws-auth
- [ ] Deploy the backend configuration, establish a new employee session, and verify the authenticated knowledge-source path. — codex-employee-ws-auth

## Notes

- Root cause: a saved `gw.openbot.love` gateway URL can survive on `openbot.love`; the host-only platform cookie is then absent from the WebSocket upgrade while the device token keeps chat operational. — codex-employee-ws-auth
- Follow-up root cause: the workbench renders from `platformAuth.session`, while gateway connection setup previously consumed only top-level `authSession`. — codex-employee-ws-auth
- Production evidence: the new UI attempted trusted-proxy WebSocket auth on `www.openbot.love`, but the gateway reported `platform session missing`; the user's membership in tenant `001` and employee session records are intact. — codex-employee-ws-auth
- Takeover evidence: the affected files are clean at the landed baseline in this isolated clone; prior broad ownership sessions are dead, and this task owns the exact authentication paths for the follow-up. — codex-employee-ws-auth
