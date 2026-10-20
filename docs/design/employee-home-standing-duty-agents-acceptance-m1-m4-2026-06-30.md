# 验收审计：员工首页常驻“值班”能力 M1–M4（2026-06-30）

评审性质：自评（以专家身份）。
被验对象：`docs/design/employee-home-standing-duty-agents-2026-06-29.md` 定义的 M1–M4
（待处理任务 / 重要通知 / 即将协作 / steward 建议层）。

> 消歧：本报告的 “M1–M4” 是**员工首页四卡 → 常驻值班**这条线，**不是**
> `docs/design/openbot-enterprise-operational-identity-v1-work-breakdown-2026-06-06.md` 里的运营身份 M4
> （那条线的 M4 仍是未成型的 `Next` 占位，见 `.kiro/specs/operational-identity-governance/acceptance-m4-2026-06-30.md`）。
> 两者仅 “M4” 撞名。

## 0. 总结论

> **更新（2026-06-30,复核后）**:原阻塞项 **① 与 ③ 已解除**（详见 §6）—— M3 / M4a / M2 企业卡 / 设计文档
> 已全部提交,`render-model.ts` 的 4 个 `AppPortState` 字段缺口已闭合。结论由「实现通过 / 交付待收尾」
> 升级为 **实现通过 + 已落地**(M4b 仍按 §7.7 暂缓)。以下 §1–§4 保留为复核时的原始审计快照,备查。

- **实现 / 功能层面：M1–M4a 全部达到验收标准**（契约匹配、测试全绿、lint/format 干净、关键鉴权与多租户隔离已做代码级核验）。
- **但“完全落地（landed）”尚不能给全绿章**，阻塞项为**交付状态**而非代码质量：M3、M4a、M2 企业管理员 UI 卡、以及设计文档本身**均未提交**；其中 **M2 企业管理员卡的 UI 未提交 = 管理员侧链路在前端断开**。
- 结论口径：**实现通过 / 交付待收尾（conditional accept）**。
- M4b：**已合理暂缓**（计费 / 用量归属未定，设计 §7.7 记录），不计入本次实现验收。

## 1. 逐里程碑判定

| 里程碑                    | 实现 | 测试       | 代码核验                             | 提交状态                       | 判定                      |
| ------------------------- | ---- | ---------- | ------------------------------------ | ------------------------------ | ------------------------- |
| M1 待处理任务             | ✅   | ✅ 6       | ✅ 跨 agent workspace + actor 作用域 | ✅ 已提交                      | **通过（已落地）**        |
| M2 重要通知（员工）       | ✅   | ✅ 4       | ✅ 仅用户作用域治理                  | ✅ 已提交                      | **通过（已落地）**        |
| M2 重要通知（企业管理员） | ✅   | ✅ 7+4     | ✅ 显式 admin 闸口                   | ⚠ 网关已提交 / **UI 卡未提交** | **实现通过 / 交付不完整** |
| M3 即将协作               | ✅   | ✅ 6       | ✅ actor 作用域 + waitingForHuman    | ❌ 未提交                      | **实现通过 / 待提交**     |
| M4a steward 建议条        | ✅   | ✅ 13 + UI | ✅ 零 token（未接 seam）             | ❌ 未提交                      | **实现通过 / 待提交**     |
| M4b gated LLM             | —    | —          | —                                    | —                              | **暂缓（设计 §7.7）**     |

## 2. 证据

### 2.1 测试（83 个全绿 / 12 文件）

- 网关 55：M1 pending 6、M2 notices 4、M2-admin 读模型 7、M3 upcoming 6、M4a steward 13、RPC workbench 15、M2-admin RPC 4。
- UI 28：控制器共载入 13、surface 4、signals 3、shell-model steward 5、企业卡 3。
- 命令：`OPENBOT_TEST_PROFILE=low pnpm exec vitest run <files>`。

### 2.2 静态门禁

- `oxlint`：21 个 M1–M4 文件 0 error / 0 warning。
- `oxfmt --check`：干净。
- `pnpm tsgo`：M1–M4 **源文件全部干净**；唯一相关报错是 `render-model.ts:2106-2109` 的 4 个
  `AppPortState` 字段缺口（见 §3.2）。

### 2.3 代码级核验（不止“测试通过”）

- **M2 企业管理员鉴权**（`src/gateway/server-methods/enterprise-notices.ts`）：`requireEnterpriseScope`
  解析租户后**显式** `if (!scope.isEnterpriseAdmin) → 拒绝`；数据全部按 `scope.enterpriseId` 租户作用域；
  各数据源 `.catch` 降级。**真实鉴权,非测试桩**。
- **M1 跨 workspace 读取**（`src/gateway/workbench/pending-tasks-read-model.ts`）：
  `readTaskAssignmentsAcrossAgentWorkspaces` 遍历默认 + 全部已配置 agent 的 workspace 并按 id 去重
  （修掉 P1 写入位置不一致）；`buildWorkbenchPendingTasks` 按 seatSpaceIds + actor 身份作用域,新成员→零。
- **M4a 零 token**：RPC handler 未传 `generateSuggestionText`,确定性模板路径,无模型调用。

## 3. 阻塞 / 风险项

### 3.1 交付状态不干净（主要阻塞“完全落地”）

- **未提交**：`src/gateway/workbench/upcoming-collaboration-read-model.ts`(+test)（M3）、
  `src/gateway/workbench/steward-suggestion-read-model.ts`(+test)（M4a）、
  `ui/src/ui/ports/enterprise/views/enterprise-system-notices-card.ts`(+browser.test)（M2 企业卡）、
  设计文档 `employee-home-standing-duty-agents-2026-06-29.md` 本身。
- M3 / M4a 的 UI 改动散落在 **已跟踪的共享文件**（`workbench-signals.ts`、`workbench-home-model.ts`、
  `workbench-shell-model.ts`、`workbench.ts`、`workbench-signals-surface.ts`、`controllers/spaces.ts`、
  `app.ts`、`app-lifecycle.ts`、`workbench.css`、`render-model.ts`、`i18n/locales/*`）里,与其他 agent
  （cursor-auto 的 knowledge / enterprise-data WIP）共居,提交需精确 scoping。
- **影响**：M2 企业卡的网关侧已提交但 UI 未提交 → 企业管理员**实际看不到**这张卡,该里程碑的用户可见链路未通。

### 3.2 tsgo：4 个本批引入的类型缺口（非运行期 bug,应收尾）

- `render-model.ts:2106-2109` 读 `state.workbenchPendingTasks/Notices/UpcomingCollaboration/StewardSuggestion`,
  但这 4 个字段未在 `AppViewWorkbenchState` 切片 / `AppPortWorkbenchState` Pick 中声明。
- 运行期安全（字段经 `app.ts` `@state` 存在,`adaptAppPortState` 为恒等转换,vite 不做类型检查故可运行）。
- 处于全树 **1625 个** in-flight `AppViewState` 迁移报错之中（tsgo 当前全树皆红,非本批独有）；M1/M2 当初也是带着这个缺口提交的。
- **建议**：把这 4 个字段补进 `AppViewWorkbenchState` + `AppPortWorkbenchState` Pick,一次性消除 M1–M4 的贡献项；或明确并入 AppViewState 迁移工单。

### 3.3 环境

- 验收时发现 `node_modules` 被并发依赖 churn 清空（与首位专家遇到的受限网络重装阻塞同源）。
- 用 `pnpm install --offline --frozen-lockfile`（本地 store,11.4s）恢复后方可跑测试。后续 CI / 验收需保证依赖可离线复原。

## 4. 达到“完全落地”所需动作

1. 提交 M3 + M4a + M2 企业卡 + 本设计文档（精确 scoping,排除他人 WIP；按多 agent 提交规范）。
2. M2 企业卡提交后,在企业管理员面回归验证其渲染（鉴权/空态/告警），补齐用户可见链路。
3. 收尾 §3.2 的 4 字段 `AppPortState` 缺口（或挂到 AppViewState 迁移）。
4. M4b 维持暂缓,待计费/用量归属口径确定后按设计 §7.7 复活路径接入。

## 5. 备注

- 另有一份未跟踪文件 `.kiro/specs/operational-identity-governance/acceptance-m4a-steward-2026-06-30.md`（非本评审创建），未改动。

## 6. 收尾更新（2026-06-30,复核后）

§4 动作执行结果:

- **① 提交 —— 已解除**:M3 / M4a / M2 企业卡 / 设计文档已落地。
  - `22b3f627dd` Gateway+UI: employee-home upcoming-collaboration + steward suggestion (M3/M4a)
  - `89c31b131b` UI: enterprise admin system-notices card (M2 admin) —— 补齐 §3.1 标记的 M2 企业卡 UI 缺口
  - `5188b07e64` Docs: 设计 + 本验收审计
  - `cad9498f93` / `7cae1f7812`: render-model 透传 + steward i18n/css。这几处原混在被 cursor-auto WIP
    污染的共享文件里(`render-model.ts` / `zh-CN.ts` / `en.ts` / `workbench.css`),经交接由该文件 owner
    外科式落地,保留我方 `Task: employee-home-signal-cards` / `Agent: kiro-home-signals` trailer;复核确认
    每处仅出现一次、无重复。
- **② M2 企业卡渲染**:卡 + 总览接线(`enterprise-overview-surface.ts`)已提交,3 个 browser 测试绿;运行 app 已可见。
- **③ AppPortState 类型缺口 —— 已闭合**:`e524f43f1b` 在 `AppViewWorkbenchState` 切片 +
  `AppPortWorkbenchState` Pick 声明 4 个 workbench 信号字段;`render-model.ts:2106-2109` 的 4 个缺口经
  tsgo 确认消除。纯类型改动,无运行期变化(字段本就是 `app.ts` 的 `@state`)。
  - 注:`app-port-state.ts` 另有 2 个**既有**错误(`:64` stale Pick key、`:409` assignability),经
    backup → `git checkout HEAD` → tsgo → restore 对照实验,实证在本次改动前的 HEAD 版本就已存在,属
    in-flight `AppViewState` 迁移债,非本线引入,留给迁移 owner。
- **④ M4b**:维持暂缓(设计 §7.7,待企业→员工计费/用量归属口径确定)。

**复核结论**:M1–M4a **实现通过 + 已落地**;唯一开放项为 M4b(产品决策暂缓)与全树 `AppViewState` 迁移债(他人范围)。
