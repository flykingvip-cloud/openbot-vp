# SAR A2：持久验证记录 → 真实安装状态

- 日期：2026-10-18（Asia/Shanghai）
- 分支：`feat/sar-a2-validation-records`
- 基线：`origin/main` A1 squash `90223851b318a0154ab66b3ff25172518d42c530`
- 专家闸门：`expert-e0-e5-acceptance-2026-10-18.md` 阻断 #2（及 E3 RPC 固定空数组）
- 路径：Path C；复用企业数据仓（E1/E5 同文件）；不扩新架构/目录
- 正式执行接入：**仍暂缓**

## 结论（诚实）

**已打通**：能力详情 / 安装投影 RPC `enterprise-data.assets.capability-install` 从企业数据仓按租户加载持久 `ValidationRecord`；有效且与钉死版本/摘要匹配 → 可执行态；缺失 / 过期 / 错版本 / 跨租户 → 失败关闭（`SAR_VERIFICATION_MISSING` 等）。

**未宣称 / 仍缺**：

| 项 | 状态 |
|----|------|
| 企业外站真实会话实测 | ❌ |
| E0–E5 整体可用 | ❌ |
| §R5 真实会话 PASS | ❌ |
| A3 桥登记/停用管理入口 + 审计 | ❌ 未做 |
| A4 物化身份与持续授权测试 | ❌ 未做 |
| A5 双中心真实浏览器闭环 | ❌ 未做 |
| 验证记录的产品写入 UI | ❌ 本阶段仅接线读取；`upsertSarValidationRecord` 供仓内持久与测例 |

## 打通路径（一句话）

`enterprise-data.assets.capability-install` → `listSarValidationRecordsForInstall(store, tenantId, now)` → `projectCapabilityCenterInstall({ validationRecords })`；去掉固定 `validationRecords: []`。

## 专家阻断对照

| 阻断 | A2 后 |
|------|--------|
| #1 治理网关未注入实际 SAR provider | A1 已接线 |
| #2 能力详情 RPC 固定空验证记录 | **已解决接线**：按租户读持久记录；空/过期/错版/跨租户 fail-closed |
| #3 桥登记/停用缺管理入口 | 未做（A3） |
| #4 E5 端到端真实浏览器 | 未做（A5） |

## 实现要点

1. `src/gateway/enterprise-data/types.ts` — `EnterpriseSarValidationRecord`（`ValidationRecord` + `tenantId` / 可选 `expiresAt` / `accessibleScope`）
2. `src/gateway/enterprise-data/store.ts` — `sarValidationRecords` 归一化进既有企业 JSON 仓
3. `src/gateway/enterprise-data/sar-validation-records.ts`
   - `upsertSarValidationRecord` / `listSarValidationRecordsForInstall`
   - 仅同租户；`expiresAt <= now` 省略；可选 `accessibleScope` 过滤
4. `src/gateway/server-methods/enterprise-data-assets.ts` — RPC 调用 list，不再写死 `[]`
5. 测例：`sar-validation-records.test.ts`
   - 有效可用；缺 / 过期 / 错版本 / 跨租户拒
   - 仓持久 load/save
   - 经注册 gateway method 一条可执行 + 一条跨租户拒
   - 源码诚实：含 `listSarValidationRecordsForInstall`，无 `validationRecords: []`

## 风险

- 生产默认仓无验证行时仍 fail-closed（正确；≠ 已放开执行）。
- 写入入口仍非产品管理面（A3 范畴）；本 PR 不宣称运营可自助录入验证。
- ControllableTestSite / 夹具 ≠ 企业外站真实账户浏览器会话。
