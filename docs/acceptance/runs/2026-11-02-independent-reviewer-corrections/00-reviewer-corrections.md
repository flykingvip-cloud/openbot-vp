# 独立复核结论与文档变更要点（2026-11-02）

**Repo:** `flykingvip-cloud/openbot-vp`  
**Coverage worktree / branch:** `docs/acceptance-coverage-20261101` → PR #193  
**main pin:** `d42fbc3ca2b4041ee70bb1dfb9cd70f33678370c`  
**时区:** Asia/Shanghai  
**范围:** `docs/acceptance/**` + `.loom/registry.yaml`（管理登记）上的**口径/文档**更新；**不是**绝对「仅文档与日志」。未修改产品代码、未安装工具链、未 merge PR。

## 用户本轮 7 点落地

1. **DEF-008**：代码根因与团队归档证据相互吻合 → **可接受为产品缺陷登记**；**独立运行复现尚未完成**（双阻断：缺 `node_modules/@openbot` 链接 **且** 无 `packages/collaboration-core/dist`；单项恢复未必够）。不得把团队复现写成「验收方已独立复现」。
2. **安全影响**：凭证排除失效；可能在备份分享/上传/存储时暴露凭证；**无**远程攻击 / 提权 / 真实泄露已发生之证明。
3. **总评**继续 **FAIL / NOT READY**。核准：接受 DEF-008 登记及 Stage4 FAIL；**不核准**全栈通过；**不据此批准 #193 合并**。
4. **覆盖完整性质疑**：固定行数（原 66 / 现 ~70）**不能证明**公开入口穷尽；且行数 = 证据/检查行，**不是**功能覆盖分母；DEF-008 多行按 1 缺陷计；不足处记「未穷尽/缺口」。
5. **禁止 PARTIAL**：`C-BACKUP-CREATE` / `TEST-UNIT-CORE` 等已拆原子行，状态仅用 PASS/FAIL/NOT_RUN/BLOCKED/N/A。
6. **修复建议收窄**：不采纳「无条件排除任意 `/credentials/`」；应 canonicalize **实际配置的凭证目录**并保留显式 `includeCredentials`。
7. 文档写明：本轮为口径/文档更新，范围含 `.loom/registry.yaml` 管理登记；无产品代码、不安依赖、不 merge。

## 文档变更清单（本轮）

| 路径                                                                 | 变更要点                                           |
| -------------------------------------------------------------------- | -------------------------------------------------- |
| `runs/2026-11-02-credentials-omit/00-pin.md`                         | 追加独立复核口径                                   |
| `runs/2026-11-02-credentials-omit/01-credentials-omit-root-cause.md` | 证据分层；安全收紧；修复建议收窄；独立复现 BLOCKED |
| `runs/2026-11-02-credentials-omit/README.md`                         | 同步上述                                           |
| `fullstack-2026-11-01/10-credentials-omit.md`                        | 摘要对齐                                           |
| `fullstack-2026-11-01/10-coverage-inventory-tracked.md`              | 去 PARTIAL；拆原子行；穷尽性声明；频道表纠偏       |
| `fullstack-2026-11-01/10-acceptance-conclusion.md`                   | FAIL/NOT READY；核准范围；不批准 #193              |
| `fullstack-2026-11-01/10-pr193-review.md`                            | 收回「据此可合并」口径                             |
| `fullstack-2026-11-01/09-coverage-progress.md`                       | 追加本轮 corrections 节                            |
| `p1-fix-2026-11-01/defect-status.md`                                 | DEF-008 字段同步                                   |
| `runs/2026-11-02-independent-reviewer-corrections/*`                 | 本目录新建                                         |

## 明确未做

- 未改 `src/**` / 产品修复
- 未 `pnpm install` / 未装工具链
- 未 `gh pr merge`
- 未触碰共享脏树 `/Users/daniel/AI VP/openbot/` 作产品写入（本轮文档工作仅在 coverage worktree）

## 后续：独立验收 Agent 本机核实第 2 轮

见同目录 [`01-owner-confirm-round2.md`](./01-owner-confirm-round2.md)（行数≠功能分母；PR 范围含 loom；独立复现双阻断）。
