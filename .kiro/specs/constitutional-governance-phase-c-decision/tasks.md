# Tasks：Phase C 决策材料清单

## Authority annotation (2026-09-27)

- Historical status: 下文清单把「启旗 / 部署 / 建包 / Path / Gate / Phase D」标成明确不做，并写 Independent acceptance COMPLETE — NO-GO。
- Superseded by: `.kiro/specs/constitutional-governance-state-convergence/current-state.md`
- Current authority: Phase C 当前决定仍是 NO-GO accepted。后来合入主干的 constitutional 包是未授权的 code-present，不把本清单改写成 Phase D 批准。`decision.md` 里的 REVISE 段落是历史签收空位，不是第二个当前决定。

> 全部为文档任务。禁止运行时编码。Codex 已授权本轮 docs-only push/PR；启旗/部署/Phase D 仍禁止。

## Checklist

- [x] Step 1：自 `origin/main` 新建工作树/分支；确认 PR #23 merge 在 main
- [x] Step 2：未提交 Loom 草稿（Owner/三 Reviewer 分离；仅 spec 路径）
- [x] Step 3：冻结 `baseline-manifest.yaml`
- [x] Step 4–9：failure-cases / alternatives-matrix / metrics / security-profile / decision + Kiro 三件套
- [x] Material Owner draft complete
- [x] Architecture review signed — `codex-architecture` — `reviews/architecture-review.md`
- [x] Security review signed — `security-reviewer:profile-ab-tenant` — `reviews/security-review.md`
- [x] Execution-chain review signed — `conversation-task-runtime:kiro-conversation-task-runtime` — `reviews/execution-chain-review.md`
- [x] Final Phase C decision accepted — see `final-acceptance.md` (five frozen bodies unchanged)
- [x] Registry landed — kiro-loom (lander-proxy) local commit
- [x] Codex 审核（人工；最终本地验收 PASS）
- [x] push/PR 本轮经 Codex 授权（仅 docs NO-GO；禁止 force-push main）
- [ ] （明确不做）启旗 / 部署 / 建包 / Path / Gate / Phase D

## Explicit status

**Independent acceptance COMPLETE — NO-GO**; Registry landed; Codex final local acceptance PASS. Push/PR authorized this round for docs-only NO-GO. Flags/deploy/Phase D/Path/Gate still forbidden.

- Material + tripartite AGREE_NO_GO complete; Final Acceptance in `final-acceptance.md`; five frozen bodies unchanged.
- Architecture：`codex-architecture` → `reviews/architecture-review.md`（`AGREE_NO_GO`）。
- Security：`security-reviewer:profile-ab-tenant` → `reviews/security-review.md`（`AGREE_NO_GO`，conditions none）。
- Execution-chain：`conversation-task-runtime:kiro-conversation-task-runtime` → `reviews/execution-chain-review.md`（`AGREE_NO_GO`）。
- Registry：landed as kiro-loom lander-proxy (Thomas authorized 2026-09-24); Codex PASS authorizes docs push/PR this round; no runtime flags/deploy/Phase D.

## 质量门（文档 only）

```bash
pnpm exec oxfmt --check \
  .kiro/specs/constitutional-governance-phase-c-decision/*.md \
  .kiro/specs/constitutional-governance-phase-c-decision/*.yaml
git diff --check
bun scripts/agent-attribution.ts --fail-on-unattributed --fail-on-conflict
```

Attribution 在未提交树上可能嘈杂：运行并报告，不为「修复」而提交。

## Registry land（本轮已授权本地）

本轮 Registry 使用 lander-proxy trailers：`Task: loom-workspace-orchestrator` / `Agent: kiro-loom`。Codex 已授权本轮 docs-only push/PR；启旗/部署/Phase D 仍禁止。
