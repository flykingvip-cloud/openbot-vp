# Artifact evidence closeout

## Agents

- codex-kb-review · role: owner · scope: shared execution instruction for exact-content verification and authorized repair · paths: src/agent-runtime/context/system-prompt.ts, src/agents/system-prompt.test.ts, .kiro/specs/artifact-evidence-closeout/\*\* · since: 2026-11-23

- [x] Live symptom: LIVE-20261123-C file exactly matches LOGIN_SCOPE_OK (14 UTF-8 bytes), SHA256 3ac95603c59abd564583e0fc379bedee30e44edf70c1b4a25f9e2af3f694f30d. Assistant invented a 13-byte expectation and a newline absent from actual bytes, then asked permission for an unnecessary rewrite. — codex-kb-review
- [x] Shared execution instruction requires programmatic byte equality, tool-derived length/tail/digest and resolution of conflicting observations; repair within existing authority then reverify rather than asking again. This is a model-behavior guardrail, not deterministic proof of arbitrary narrative correctness. — codex-kb-review
- [ ] Unit/type/lint and live-model retest. — codex-kb-review
