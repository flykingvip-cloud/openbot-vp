# Security Policy

If you believe you've found a security issue in OpenBot, please report it privately.

## Reporting

Report vulnerabilities directly to the repository where the issue lives:

- **Core CLI and gateway** — [gmood2008/openbot](https://github.com/gmood2008/openbot)
- **macOS desktop app** — [gmood2008/openbot](https://github.com/gmood2008/openbot) (apps/macos)
- **iOS app** — [gmood2008/openbot](https://github.com/gmood2008/openbot) (apps/ios)
- **Android app** — [gmood2008/openbot](https://github.com/gmood2008/openbot) (apps/android)

For issues that don't fit a specific repo, or if you're unsure, email **[security@openbot.ai](mailto:security@openbot.ai)** and we'll route it.

### Required in Reports

1. **Title**
2. **Severity Assessment**
3. **Impact**
4. **Affected Component**
5. **Technical Reproduction**
6. **Demonstrated Impact**
7. **Environment**
8. **Remediation Advice**

Reports without reproduction steps, demonstrated impact, and remediation advice will be deprioritized. Given the volume of AI-generated scanner findings, we must ensure we're receiving vetted reports from researchers who understand the issues.

### Report Acceptance Gate (Triage Fast Path)

For fastest triage, include all of the following:

- Exact vulnerable path (`file`, function, and line range) on a current revision.
- Tested version details (OpenBot version and/or commit SHA).
- Reproducible PoC against latest `main` or latest released version.
- Demonstrated impact tied to OpenBot's documented trust boundaries.
- For exposed-secret reports: proof the credential is OpenBot-owned (or grants access to OpenBot-operated infrastructure/services).
- Explicit statement that the report does not rely on adversarial operators sharing one gateway host/config.
- Scope check explaining why the report is **not** covered by the Out of Scope section below.
- For command-risk/parity reports (for example obfuscation detection differences), a concrete boundary-bypass path is required (auth/approval/allowlist/sandbox). Parity-only findings are treated as hardening, not vulnerabilities.

Reports that miss these requirements may be closed as `invalid` or `no-action`.

### Common False-Positive Patterns

These are frequently reported but are typically closed with no code change:

- Prompt-injection-only chains without a boundary bypass (prompt injection is out of scope).
- Operator-intended local features (for example TUI local `!` shell) presented as remote injection.
- Reports that treat explicit operator-control surfaces (for example `canvas.eval`, browser evaluate/script execution, or direct `node.invoke` execution primitives) as vulnerabilities without demonstrating an auth/policy/sandbox boundary bypass. These capabilities are intentional when enabled and are trusted-operator features, not standalone security bugs.
- Authorized user-triggered local actions presented as privilege escalation. Example: an allowlisted/owner sender running `/export-session /absolute/path.html` to write on the host. In this trust model, authorized user actions are trusted host actions unless you demonstrate an auth/sandbox/boundary bypass.
- Reports that only show a malicious plugin executing privileged actions after a trusted operator installs/enables it.
- Reports that assume per-user multi-tenant authorization on a shared gateway host/config.
- Reports that only show differences in heuristic detection/parity (for example obfuscation-pattern detection on one exec path but not another, such as `node.invoke -> system.run` parity gaps) without demonstrating bypass of auth, approvals, allowlist enforcement, sandboxing, or other documented trust boundaries.
- ReDoS/DoS claims that require trusted operator configuration input (for example catastrophic regex in `sessionFilter` or `logging.redactPatterns`) without a trust-boundary bypass.
- Archive/install extraction claims that require pre-existing local filesystem priming in trusted state (for example planting symlink/hardlink aliases under destination directories such as skills/tools paths) without showing an untrusted path that can create/control that primitive.
- Reports that depend on replacing or rewriting an already-approved executable path on a trusted host (same-path inode/content swap) without showing an untrusted path to perform that write.
- Reports that depend on pre-existing symlinked skill/workspace filesystem state (for example symlink chains involving `skills/*/SKILL.md`) without showing an untrusted path that can create/control that state.
- Missing HSTS findings on default local/loopback deployments.
- Slack webhook signature findings when HTTP mode already uses signing-secret verification.
- Discord inbound webhook signature findings for paths not used by this repo's Discord integration.
- Claims that Microsoft Teams `fileConsent/invoke` `uploadInfo.uploadUrl` is attacker-controlled without demonstrating one of: auth boundary bypass, a real authenticated Teams/Bot Framework event carrying attacker-chosen URL, or compromise of the Microsoft/Bot trust path.
- Scanner-only claims against stale/nonexistent paths, or claims without a working repro.

### Duplicate Report Handling

- Search existing advisories before filing.
- Include likely duplicate GHSA IDs in your report when applicable.
- Maintainers may close lower-quality/later duplicates in favor of the earliest high-quality canonical report.

## Security & Trust

**Jamieson O'Reilly** ([@theonejvo](https://twitter.com/theonejvo)) is Security & Trust at OpenBot. Jamieson is the founder of [Dvuln](https://dvuln.com) and brings extensive experience in offensive security, penetration testing, and security program development.

## Bug Bounties

OpenBot is a labor of love. There is no bug bounty program and no budget for paid reports. Please still disclose responsibly so we can fix issues quickly.
The best way to help the project right now is by sending PRs.

## Maintainers: GHSA Updates via CLI

When patching a GHSA via `gh api`, include `X-GitHub-Api-Version: 2022-11-28` (or newer). Without it, some fields (notably CVSS) may not persist even if the request returns 200.

## Operator Trust Model (Important)

OpenBot supports **two explicit, mutually exclusive security profiles**. The same
deployment must not be documented or configured as both a trusted single-operator
gateway and an adversarial multi-tenant boundary.

### Profile A — Personal Local (`personal_local`)

This is the historical personal-assistant model:

- One trusted operator per Gateway process is the recommended deployment.
- Authenticated Gateway callers are treated as trusted operators for that gateway instance.
- Session identifiers (`sessionKey`, session IDs, labels) are routing controls for sessions **inside** the active operator's state root, not a license to read another operator's stores.
- Authenticated gateway clients carry operator identity (`platformUserId`, else paired device id, else connect user). Each request/turn enters an AsyncLocalStorage operator scope so session stores resolve under `$OPENBOT_STATE_DIR/operators/<id>/` and plugin `stateDir` follows that root. Unauthorized cross-operator store paths fail closed (`CROSS_OPERATOR_STATE_DENIED`).
- `OPENBOT_OPERATOR_ID` remains a test/dev override only; production isolation is request-scoped from authenticated identity, not a process-wide env that nothing sets.
- Recommended mode: one user per machine/host (or VPS), one gateway for that user, and one or more agents inside that operator root. Connects with no user/device identity stay on the legacy shared `STATE_DIR` (explicit single-operator leftover).
- If multiple mutually untrusted users share one host, each authenticated operator gets a distinct scoped root on their requests; prefer separate host/OS user boundaries as well — do not rely on shared-token-only connects for isolation.
- Exec behavior is host-first by default: `agents.defaults.sandbox.mode` defaults to `off`.
- `tools.exec.host` defaults to `sandbox` as a routing preference, but if sandbox runtime is not active for the session, exec runs on the gateway host.
- This profile never authorizes Managed Enterprise / SaaS cross-tenant isolation claims.

### Profile B — Managed Enterprise (`managed_enterprise`)

Managed SaaS and enterprise private deployments use a different contract:

- Tenants are mutually untrusted security boundaries. Cross-tenant access is a P0 security event.
- Tenant and user identity come only from authenticated membership context.
- Missing context, unknown resources, and ambiguous storage bindings fail closed.
- Until shared-process I3 isolation is separately proven, production Managed Enterprise
  **requires a dedicated tenant execution boundary** (dedicated Gateway/worker, tenant-scoped
  data root, credentials, browser state, queues/caches). Shared-process managed execution
  is rejected at startup.
- Plugins must not receive unrestricted in-process access to all tenant data.
- Profile selection is server-controlled (`OPENBOT_SECURITY_PROFILE` / `gateway.security.profile`).
  Client input cannot choose or override the profile.

Gateway startup validates the active profile (see `src/gateway/security-profile.ts`) and
emits a redacted audit summary containing profile and isolation level.

## Trusted Plugin Concept (Core)

Plugins/extensions are part of OpenBot's trusted computing base for a gateway.

- Installing or enabling a plugin grants it the same trust level as local code running on that gateway host, within the active operator `stateDir` (request-scoped from authenticated identity via AsyncLocalStorage; env override is test/dev only).
- Plugin behavior such as reading env/files or running host commands is expected inside this trust boundary; `stateDir` is a lazy getter and must not expose another operator's root while a request scope is active.
- Security reports must show a boundary bypass (for example unauthenticated plugin load, allowlist/policy bypass, or sandbox/path-safety bypass), not only malicious behavior from a trusted-installed plugin.

## Out of Scope

- Public Internet Exposure
- Using OpenBot in ways that the docs recommend not to
- Deployments where mutually untrusted/adversarial operators share one gateway **only via shared-token connects with no `platformUserId` / paired device / user identity** (legacy unscoped `STATE_DIR`), or without separate host/OS user boundaries. Authenticated per-operator store/plugin `stateDir` isolation applies on the request ALS path; reports that only demand per-operator isolation for control-plane RPCs such as `sessions.list`, `sessions.preview`, or `chat.history` without a store/path bypass remain out of scope.
- Prompt-injection-only attacks (without a policy/auth/sandbox boundary bypass)
- Reports that require write access to trusted local state (`~/.openbot`, workspace files like `MEMORY.md` / `memory/*.md`)
- Reports where exploitability depends on attacker-controlled pre-existing symlink/hardlink filesystem state in trusted local paths (for example extraction/install target trees) unless a separate untrusted boundary bypass is shown that creates that state.
- Reports whose only claim is sandbox/workspace read expansion through trusted local skill/workspace symlink state (for example `skills/*/SKILL.md` symlink chains) unless a separate untrusted boundary bypass is shown that creates/controls that state.
- Reports whose only claim is post-approval executable identity drift on a trusted host via same-path file replacement/rewrite unless a separate untrusted boundary bypass is shown for that host write primitive.
- Reports where the only demonstrated impact is an already-authorized sender intentionally invoking a local-action command (for example `/export-session` writing to an absolute host path) without bypassing auth, sandbox, or another documented boundary
- Reports whose only claim is use of an explicit trusted-operator control surface (for example `canvas.eval`, browser evaluate/script execution, or direct `node.invoke` execution) without demonstrating an auth, policy, allowlist, approval, or sandbox bypass.
- Reports where the only claim is that a trusted-installed/enabled plugin can execute with gateway/host privileges (documented trust model behavior).
- Any report whose only claim is that an operator-enabled `dangerous*`/`dangerously*` config option weakens defaults (these are explicit break-glass tradeoffs by design)
- Reports that depend on trusted operator-supplied configuration values to trigger availability impact (for example custom regex patterns). These may still be fixed as defense-in-depth hardening, but are not security-boundary bypasses.
- Reports whose only claim is heuristic/parity drift in command-risk detection (for example obfuscation-pattern checks) across exec surfaces, without a demonstrated trust-boundary bypass. These are hardening-only findings and are not vulnerabilities; triage may close them as `invalid`/`no-action` or track them separately as low/informational hardening.
- Reports whose only claim is that exec approvals do not semantically model every interpreter/runtime loader form, subcommand, flag combination, package script, or transitive module/config import. Exec approvals bind exact request context and best-effort direct local file operands; they are not a complete semantic model of everything a runtime may load.
- Exposed secrets that are third-party/user-controlled credentials (not OpenBot-owned and not granting access to OpenBot-operated infrastructure/services) without demonstrated OpenBot impact
- Reports whose only claim is host-side exec when sandbox runtime is disabled/unavailable (documented default behavior in the trusted-operator model), without a boundary bypass.
- Reports whose only claim is that a platform-provided upload destination URL is untrusted (for example Microsoft Teams `fileConsent/invoke` `uploadInfo.uploadUrl`) without proving attacker control in an authenticated production flow.

## Deployment Assumptions

OpenBot security guidance assumes:

- The host where OpenBot runs is within a trusted OS/admin boundary.
- Anyone who can modify `~/.openbot` state/config (including `openbot.json`) is effectively a trusted operator.
- A single Gateway shared by mutually untrusted people is **not a recommended setup**. Use separate gateways (or at minimum separate OS users/hosts) per trust boundary.
- Authenticated Gateway callers are treated as trusted operators. Session identifiers (for example `sessionKey`) are routing controls, not per-user authorization boundaries.
- Multiple gateway instances can run on one machine, but the recommended model is clean per-user isolation (prefer one host/VPS per user).

## One-User Trust Model (Personal Assistant)

OpenBot's security model is "personal assistant" (one trusted operator, potentially many agents), not "shared multi-tenant bus."

- If multiple people can message the same tool-enabled agent (for example a shared Slack workspace), they can all steer that agent within its granted permissions.
- Session or memory scoping reduces context bleed, but does **not** create per-user host authorization boundaries.
- For mixed-trust or adversarial users, isolate by OS user/host/gateway and use separate credentials per boundary.
- A company-shared agent can be a valid setup when users are in the same trust boundary and the agent is strictly business-only.
- For company-shared setups, use a dedicated machine/VM/container and dedicated accounts; avoid mixing personal data on that runtime.
- If that host/browser profile is logged into personal accounts (for example Apple/Google/personal password manager), you have collapsed the boundary and increased personal-data exposure risk.

## Deployment security profiles (Gate 0)

OpenBot distinguishes two machine-checkable deployment profiles resolved at gateway startup from **server-controlled** config and environment only (`data.mode`, `OPENBOT_DATA_MODE`). Client RPC parameters cannot select the profile.

| Profile               | `data.mode`       | Trust assumption                                                                                                                        |
| --------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **PersonalLocal**     | `local` (default) | One trusted operator on a personal or self-hosted machine. Matches the one-user trust model below.                                      |
| **ManagedEnterprise** | `managed`         | Adversarial multi-tenant SaaS or enterprise deployment. Requires a dedicated tenant execution boundary before serving employee traffic. |

**PersonalLocal** uses documented local defaults and the trusted-operator assumptions in this document.

**ManagedEnterprise** startup fails closed unless:

- `OPENBOT_TENANTS_ROOT` is explicitly configured to a dedicated tenant volume root;
- tenant isolation is enabled via `OPENBOT_MULTITENANT=1` or server-side `data.tenantId` on a dedicated worker;
- the tenant volume root does not alias the gateway config/state/credential root or the global data root.

Managed production must not run under PersonalLocal trust assumptions. Security reports for managed deployments should demonstrate boundary bypass within the ManagedEnterprise profile, not assume a single trusted operator on a shared gateway host.

## Agent and Model Assumptions

- The model/agent is **not** a trusted principal. Assume prompt/content injection can manipulate behavior.
- Security boundaries come from host/config trust, auth, tool policy, sandboxing, and exec approvals.
- Prompt injection by itself is not a vulnerability report unless it crosses one of those boundaries.
- Hook/webhook-driven payloads should be treated as untrusted content; keep unsafe bypass flags disabled unless doing tightly scoped debugging (`hooks.gmail.allowUnsafeExternalContent`, `hooks.mappings[].allowUnsafeExternalContent`).
- Weak model tiers are generally easier to prompt-inject. For tool-enabled or hook-driven agents, prefer strong modern model tiers and strict tool policy (for example `tools.profile: "messaging"` or stricter), plus sandboxing where possible.

## Gateway and Node trust concept

OpenBot separates routing from execution, but both remain inside the same operator trust boundary:

- **Gateway** is the control plane. If a caller passes Gateway auth, they are treated as a trusted operator for that Gateway.
- **Node** is an execution extension of the Gateway. Pairing a node grants operator-level remote capability on that node.
- **Exec approvals** (allowlist/ask UI) are operator guardrails to reduce accidental command execution, not a multi-tenant authorization boundary.
- Exec approvals bind exact command/cwd/env context and, when OpenBot can identify one concrete local script/file operand, that file snapshot too. This is best-effort integrity hardening, not a complete semantic model of every interpreter/runtime loader path.
- Differences in command-risk warning heuristics between exec surfaces (`gateway`, `node`, `sandbox`) do not, by themselves, constitute a security-boundary bypass.
- For untrusted-user isolation, split by trust boundary: separate gateways and separate OS users/hosts per boundary.

## Workspace Memory Trust Boundary

`MEMORY.md` and `memory/*.md` are plain workspace files and are treated as trusted local operator state.

- If someone can edit workspace memory files, they already crossed the trusted operator boundary.
- Memory search indexing/recall over those files is expected behavior, not a sandbox/security boundary.
- Example report pattern considered out of scope: "attacker writes malicious content into `memory/*.md`, then `memory_search` returns it."
- If you need isolation between mutually untrusted users, split by OS user or host and run separate gateways.

## Plugin Trust Boundary

Plugins/extensions are loaded **in-process** with the Gateway and are treated as trusted code.

- Plugins can execute with the same OS privileges as the OpenBot process.
- Runtime helpers (for example `runtime.system.runCommandWithTimeout`) are convenience APIs, not a sandbox boundary.
- Only install plugins you trust, and prefer `plugins.allow` to pin explicit trusted plugin ids.

## Temp Folder Boundary (Media/Sandbox)

OpenBot uses a dedicated temp root for local media handoff and sandbox-adjacent temp artifacts:

- Preferred temp root: the OpenBot-managed temp root (current compatibility path: `/tmp/openclaw` when available and safe on the host).
- Fallback temp root: a scoped subdirectory under `os.tmpdir()` (current compatibility form: `openclaw` or `openclaw-<uid>` on multi-user hosts).

Security boundary notes:

- Sandbox media validation allows absolute temp paths only under the OpenBot-managed temp root.
- Arbitrary host tmp paths are not treated as trusted media roots.
- Plugin/extension code should use the built-in OpenBot temp helpers rather than raw `os.tmpdir()` defaults when handling media files.
- Enforcement reference points live in the temp-root resolver, SDK temp helpers, and messaging/channel tmp guardrail implementation.

## Operational Guidance

For threat model + hardening guidance (including `openbot security audit --deep` and `--fix`), see:

- `https://docs.openbot.love/gateway/security`

### Tool filesystem hardening

- `tools.exec.applyPatch.workspaceOnly: true` (recommended): keeps `apply_patch` writes/deletes within the configured workspace directory.
- `tools.fs.workspaceOnly: true` (optional): restricts `read`/`write`/`edit`/`apply_patch` paths and native prompt image auto-load paths to the workspace directory.
- Avoid setting `tools.exec.applyPatch.workspaceOnly: false` unless you fully trust who can trigger tool execution.

### Sub-agent delegation hardening

- Keep `sessions_spawn` denied unless you explicitly need delegated runs.
- Keep `agents.list[].subagents.allowAgents` narrow, and only include agents with sandbox settings you trust.
- When delegation must stay sandboxed, call `sessions_spawn` with `sandbox: "require"` (default is `inherit`).
  - `sandbox: "require"` rejects the spawn unless the target child runtime is sandboxed.
  - This prevents a less-restricted session from delegating work into an unsandboxed child by mistake.

### Web Interface Safety

OpenBot's web interface (Gateway Control UI + HTTP endpoints) is intended for **local use only**.

- Recommended: keep the Gateway **loopback-only** (`127.0.0.1` / `::1`).
  - Config: `gateway.bind="loopback"` (default).
  - CLI: `openbot gateway run --bind loopback`.
- `gateway.controlUi.dangerouslyDisableDeviceAuth` is intended for localhost-only break-glass use.
  - OpenBot keeps deployment flexibility by design and does not hard-forbid non-local setups.
  - Non-local and other risky configurations are surfaced by `openbot security audit` as dangerous findings.
  - This operator-selected tradeoff is by design and not, by itself, a security vulnerability.
- Canvas host note: network-visible canvas is **intentional** for trusted node scenarios (LAN/tailnet).
  - Expected setup: non-loopback bind + Gateway auth (token/password/trusted-proxy) + firewall/tailnet controls.
  - Current compatibility routes: `/__openclaw__/canvas/`, `/__openclaw__/a2ui/`.
  - This deployment model alone is not a security vulnerability.
- Do **not** expose it to the public internet (no direct bind to `0.0.0.0`, no public reverse proxy). It is not hardened for public exposure.
- If you need remote access, prefer an SSH tunnel or Tailscale serve/funnel (so the Gateway still binds to loopback), plus strong Gateway auth.
- The Gateway HTTP surface includes the current canvas-host compatibility routes (`/__openclaw__/canvas/`, `/__openclaw__/a2ui/`). Treat canvas content as sensitive/untrusted and avoid exposing it beyond loopback unless you understand the risk.

## Runtime Requirements

### Node.js Version

OpenBot requires **Node.js 22.12.0 or later** (LTS). This version includes important security patches:

- CVE-2025-59466: async_hooks DoS vulnerability
- CVE-2026-21636: Permission model bypass vulnerability

Verify your Node.js version:

```bash
node --version  # Should be v22.12.0 or later
```

### Docker Security

When running OpenBot in Docker:

1. The official image runs as a non-root user (`node`) for reduced attack surface
2. Use `--read-only` flag when possible for additional filesystem protection
3. Limit container capabilities with `--cap-drop=ALL`

Example secure Docker run:

```bash
docker run --read-only --cap-drop=ALL \
  -v openbot-data:/app/data \
  ghcr.io/gmood2008/openbot:latest
```

## Security Scanning

This project uses `detect-secrets` for automated secret detection in CI/CD.
See `.detect-secrets.cfg` for configuration and `.secrets.baseline` for the baseline.

Run locally:

```bash
pip install detect-secrets==1.5.0
detect-secrets scan --baseline .secrets.baseline
```
