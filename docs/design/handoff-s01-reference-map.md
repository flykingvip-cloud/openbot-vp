> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# Handoff S01 文档引用关系图

**文档版本**: 2026-08-29  
**任务**: handoff-s01-convergence  
**Worktree**: `openbot-handoff-s01-clean`

---

## 1. 核心引用层次

```
主 Handoff (已落地)
├── D1: Trusted Principal 契约
│   ├── R1: 匿名/本地安全语义
│   ├── R3: Trusted Proxy 威胁模型
│   └── D1 收敛补丁 (补丁 1, 2)
│
├── D2: Workspace Handle 模型
│   ├── R2: 授权矩阵
│   └── D2/D4/D5 收敛补丁 (补丁 3)
│
├── D3: Catalog 扩展
│   └── R6: 单 SoT 验收脚本
│
├── D4: resolveAuthorizedToolCwd 接口
│   ├── R1: 匿名/本地安全语义
│   ├── R2: 授权矩阵
│   ├── R5: 审计失败语义
│   └── D2/D4/D5 收敛补丁 (补丁 4)
│
└── D5: 回归防护测试计划
    ├── R1-R6: 全部修订
    ├── R4: 性能基准
    └── D2/D4/D5 收敛补丁 (补丁 5)
```

---

## 2. 主 Handoff → D1-D5 引用

| 文档           | 文件名                                                    | 被引用位置                   |
| -------------- | --------------------------------------------------------- | ---------------------------- |
| **主 Handoff** | `handoff-s01-trusted-principal-handle-gate.md`            | PR #807 已落地               |
| **D1**         | `handoff-s01-d1-trusted-principal-contract.md`            | 主 Handoff §2, R1/R3 收敛    |
| **D2**         | `handoff-s01-d2-workspace-handle-model.md`                | 主 Handoff §3, R2 收敛       |
| **D3**         | `handoff-s01-d3-catalog-extension.md`                     | 主 Handoff §4                |
| **D4**         | `handoff-s01-d4-resolve-authorized-tool-cwd-interface.md` | 主 Handoff §5, R1/R2/R5 收敛 |
| **D5**         | `handoff-s01-d5-regression-prevention-test-plan.md`       | 主 Handoff §6, R1-R6 收敛    |

---

## 3. D1-D5 → R1-R8 引用

### 3.1 R1: 匿名/本地安全语义

- **修订文档**: `handoff-s01-revision-r1-anonymous-local-security.md`
- **收敛补丁**: `handoff-s01-d1-convergence-patch.md` §补丁 2
- **影响范围**:
  - D1 §9.2 "降级策略" → `[SUPERSEDED BY R1]`
  - D4 集成新的本地安全检查
  - D5 新增 R1 验收测试

### 3.2 R2: 授权矩阵

- **修订文档**: `handoff-s01-revision-r2-authorization-matrix.md`
- **收敛补丁**: `handoff-s01-d2-d4-d5-convergence-patches.md` §补丁 3, §补丁 4
- **影响范围**:
  - D2 §3 "租户绑定与隔离" → `[SUPERSEDED BY R2]`
  - D4 §5 "核心实现逻辑" 集成授权矩阵检查
  - D5 新增 R2 授权测试

### 3.3 R3: Trusted Proxy 威胁模型

- **修订文档**: `handoff-s01-revision-r3-trusted-proxy-threat-model.md`
- **收敛补丁**: `handoff-s01-d1-convergence-patch.md` §补丁 1
- **影响范围**:
  - D1 §3.2.2 "Trusted Proxy Header" → `[SUPERSEDED BY R3]`
  - D5 新增 R3 代理安全测试

### 3.4 R4: 性能基准

- **修订文档**: `handoff-s01-revision-r4-performance-benchmark.md`
- **收敛补丁**: `handoff-s01-d2-d4-d5-convergence-patches.md` §补丁 5
- **影响范围**:
  - D5 §6 "性能测试" 集成 R4 性能基准
  - 新增 3 项性能测试

### 3.5 R5: 审计失败语义

- **修订文档**: `handoff-s01-revision-r5-audit-failure-semantics.md`
- **收敛补丁**: `handoff-s01-d2-d4-d5-convergence-patches.md` §补丁 4
- **影响范围**:
  - D4 §9 "审计日志" 集成 Fail-Closed 策略
  - D5 §4 "集成测试" 新增审计失败测试

### 3.6 R6: 单 SoT 验收脚本

- **修订文档**: `handoff-s01-revision-r6-single-sot-verification.md`
- **可运行脚本**: `scripts/verify-single-sot.ts`
- **影响范围**:
  - D3 Catalog 扩展的验收证据
  - D5 新增 R6 机器检查测试
  - `package.json` 添加 `verify:single-sot` 脚本

### 3.7 R7-R8: 文档一致性

- **修订文档**: `handoff-s01-revision-r7-r8-documentation-consistency.md`
- **影响范围**:
  - R7: 修正 D2/D3/D4/D5 文件名
  - R8: 统一 20 个文档清单

---

## 4. Review Guide 引用

**文档**: `handoff-s01-design-review-guide.md`

### 4.1 评审检查清单

1. **核心设计完整性**: 主 Handoff + D1-D5
2. **修订规范收敛**: R1-R8 是否正确集成到 D1-D5
3. **机器验收证据**: R6 脚本是否可运行并输出预期违规
4. **文档一致性**: R7-R8 文件名和清单是否正确

### 4.2 引用的文档（按优先级）

| 优先级 | 文档组     | 文件                                                                                   |
| ------ | ---------- | -------------------------------------------------------------------------------------- |
| P0     | 主 Handoff | `handoff-s01-trusted-principal-handle-gate.md`                                         |
| P1     | 核心设计   | D1-D5 (5 个文件)                                                                       |
| P1     | 收敛补丁   | `handoff-s01-d1-convergence-patch.md`<br>`handoff-s01-d2-d4-d5-convergence-patches.md` |
| P2     | 修订规范   | R1-R8 (8 个文件)                                                                       |
| P2     | 验收脚本   | `scripts/verify-single-sot.ts`                                                         |
| P3     | 总结文档   | `handoff-s01-consolidated.md`<br>`handoff-s01-design-completion-summary.md`            |

---

## 5. 验收证据

### 5.1 R6 脚本运行结果

```bash
$ pnpm verify:single-sot

🚀 Single Source of Truth Verification

🔍 Running static scan...
❌ Static scan: FAILED (1 violations)
   src/gateway/workspace-resolver/access.ts:95
   [no-fs-write-persistent] Forbidden: Persistent file write. Use Catalog API or temp directory.
   Code: fs.writeFileSync(abs, content, "utf8");

🔍 Checking Catalog API encapsulation...
❌ API encapsulation: FAILED (1 violations)
   resolveAuthorizedToolCwd does not use catalog parameter

🔍 Verifying migration evidence...
✅ Migration evidence: PASSED

📊 Summary:
   Static Scan: ❌
   API Encapsulation: ❌
   Migration Evidence: ✅

❌ Some checks failed!
Exit code: 1
```

**预期违规**（符合 R6 验收标准）:

1. ✅ Static Scan: `access.ts:95` 直接文件写入
2. ✅ API Encapsulation: `resolveAuthorizedToolCwd` 未使用 catalog 参数

### 5.2 文件清单验证

```bash
$ git diff origin/main...HEAD --name-only | wc -l
23

$ git diff origin/main...HEAD --name-only | grep -c "handoff-s01-"
21
```

✅ **验证通过**: 只包含 S01 相关文件（21 个文档 + 1 个脚本 + 1 个 Loom registry）

---

## 6. 最终交付

### 6.1 完整文档清单（21 个）

1. `handoff-s01-consolidated.md`
2. `handoff-s01-convergence-plan.md`
3. `handoff-s01-d1-convergence-patch.md`
4. `handoff-s01-d1-trusted-principal-contract.md`
5. `handoff-s01-d2-d4-d5-convergence-patches.md`
6. `handoff-s01-d2-workspace-handle-model.md`
7. `handoff-s01-d3-catalog-extension.md`
8. `handoff-s01-d4-resolve-authorized-tool-cwd-interface.md`
9. `handoff-s01-d5-regression-prevention-test-plan.md`
10. `handoff-s01-design-completion-summary.md`
11. `handoff-s01-design-review-guide.md`
12. `handoff-s01-re-review-request.md`
13. `handoff-s01-revision-plan.md`
14. `handoff-s01-revision-r1-anonymous-local-security.md`
15. `handoff-s01-revision-r2-authorization-matrix.md`
16. `handoff-s01-revision-r3-trusted-proxy-threat-model.md`
17. `handoff-s01-revision-r4-performance-benchmark.md`
18. `handoff-s01-revision-r5-audit-failure-semantics.md`
19. `handoff-s01-revision-r6-single-sot-verification.md`
20. `handoff-s01-revision-r7-r8-documentation-consistency.md`
21. `handoff-s01-revision-summary.md`

### 6.2 可运行脚本

- `scripts/verify-single-sot.ts` (R6 验收脚本)
- `package.json` 添加 `verify:single-sot: tsx scripts/verify-single-sot.ts`

### 6.3 Loom 配置

- 任务: `handoff-s01-convergence:kiro-daibai`
- Landing Stream: `HANDOFF-S01` (serial policy)
- 路径: `docs/design/handoff-s01-*.md`, `scripts/verify-single-sot.ts`, `.loom/registry.yaml`

---

## 附录: 快速导航

| 需求                  | 目标文档                                                  |
| --------------------- | --------------------------------------------------------- |
| 查看完整 Handoff      | `handoff-s01-consolidated.md`                             |
| 评审指南              | `handoff-s01-design-review-guide.md`                      |
| D1: Trusted Principal | `handoff-s01-d1-trusted-principal-contract.md`            |
| D2: Handle 模型       | `handoff-s01-d2-workspace-handle-model.md`                |
| D3: Catalog 扩展      | `handoff-s01-d3-catalog-extension.md`                     |
| D4: 接口设计          | `handoff-s01-d4-resolve-authorized-tool-cwd-interface.md` |
| D5: 测试计划          | `handoff-s01-d5-regression-prevention-test-plan.md`       |
| R1-R8 修订总结        | `handoff-s01-revision-summary.md`                         |
| R6 脚本               | `scripts/verify-single-sot.ts`                            |
| 收敛计划              | `handoff-s01-convergence-plan.md`                         |
