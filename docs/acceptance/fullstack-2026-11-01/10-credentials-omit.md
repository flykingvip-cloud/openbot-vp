# 10 — Credentials-omit (Stage4 / backup) — 2026-11-02

See full write-up: [`../runs/2026-11-02-credentials-omit/01-credentials-omit-root-cause.md`](../runs/2026-11-02-credentials-omit/01-credentials-omit-root-cause.md)

**Summary:** Product **FAIL** on pin `d42fbc3ca2…`. Default backup packs `credentials/oauth.json` when state dir realpath differs from logical `oauthDir` (macOS `/var` vs `/private/var`). Manifest still says credentials excluded. **DEF-008**, security boundary **YES**. No product patch in this docs update.
