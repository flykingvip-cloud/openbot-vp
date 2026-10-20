# 平台端与企业端 UI 稳定化验收说明（2026-06-23）

## 验收清单

- [x] 企业端关键页面残留英文已清理一批核心用户可见区域
- [x] 企业端“渠道治理”冗余模块已整块删除
- [x] 企业能力中心首屏已完成结构性减负
- [x] 平台端主页面 tab 已恢复并完成刷新机制收敛
- [x] 关键 browser/unit 回归通过
- [x] `pnpm ui:build` 通过
- [x] OpenBot 已重启并切换到最新 UI bundle

## 背景

本轮工作围绕以下四类问题展开：

1. 企业端页面残留英文，影响正式交付观感与一致性。
2. 企业端“渠道治理”模块已判定为冗余，应从导航、路由、surface 与状态链路中删除。
3. 企业能力中心首屏加载偏重，存在非首屏数据提前加载与隐藏面板预构造问题。
4. 平台端多个主模块与内部 tab 依赖不统一的 `history/popstate` 刷新模式，存在“URL 已变但页面未切换”类风险。

## 实施范围

### 企业端

- 企业租户选择页文案中文化
- 企业能力中心概览文案中文化
- 企业组织页混合术语中文化
- 企业数据能力中心术语中文化
- 企业能力中心首屏懒加载收敛
- 删除“渠道治理”冗余模块及其 tenant-scoped channel config 状态链路

### 平台端

- `platform models` 各 section 局部刷新机制统一
- `platform agents` / `platform advanced` / `platform system settings` 局部刷新机制统一
- `platform tenants` / `platform pricing` 剩余双写刷新路径收敛
- `platform pricing` 在“宿主存在 / 宿主不存在”两种运行场景下的刷新兼容

## 关键结果

### 1. 企业端残留英文已清理一批核心用户可见区域

已处理：

- 企业租户选择页
- 企业能力中心概览眉题
- 企业组织页中的 `Memory Scope` / `Runtime`
- 企业数据能力中心中的 `seat grant` / `Runtime Action` / `Action Refs` / `Source IDs` / 状态与分类英文值

结果：

- 企业端关键管理页面从“半中半英”收敛为以中文业务术语为主
- 相关 browser/unit 测试已同步更新并通过

### 2. 企业端“渠道治理”模块已整块删除

已删除或移除：

- enterprise 导航与 tab 注册中的 `enterpriseChannels`
- enterprise surface 分发与类型接线
- 企业端渠道治理页面本体
- tenant-scoped channel config controller
- 对应测试文件与 i18n 文案键

结果：

- 冗余入口不再出现在企业端
- 不再保留只隐藏 UI、但底层状态仍运行的半删除状态

### 3. 企业能力中心首屏已做结构性减负

已完成：

- 去掉首页对审核队列、安装管理、贡献排行等非首屏数据的隐式预加载
- 去掉隐藏子面板的提前构造
- 首屏 KPI 对未进入子页的数据改为中性占位，而非误导性的“加载中”

结果：

- 企业能力中心首屏请求边界收窄
- 首屏渲染负担下降
- 回归测试新增“首页不得预拉二级页数据”约束

### 4. 平台端主页面 tab 已恢复并完成机制收敛

已完成：

- `platform models` 五个 section 的局部刷新统一走平台宿主重绘入口
- `platform agents` / `platform advanced` / `platform system settings` 局部刷新统一
- `platform tenants` / `platform pricing` 双写刷新路径收敛
- `platform pricing` 保留“无宿主时兜底派发 popstate”的兼容逻辑

结果：

- 平台端 8 个主模块入口可正常打开
- 主模块与关键内部 tab 切换链路完成结构性收敛
- 平台端“主页面 tab 已完全恢复”的观察，与代码层收敛结果一致

## 验收证据

### 关键测试

已通过的关键测试包括但不限于：

- `ui/src/ui/views/enterprise-asset-library/capability-overview.test.ts`
- `ui/src/ui/ports/enterprise/views/enterprise-data-capability-home.browser.test.ts`
- `ui/src/ui/ports/enterprise/views/enterprise-surfaces.browser.test.ts`
- `ui/src/ui/ports/enterprise/views/enterprise-usage-surface.browser.test.ts`
- `ui/src/ui/ports/platform/views/platform-capabilities-shell.browser.test.ts`
- `ui/src/ui/ports/platform/advanced/page.browser.test.ts`
- `ui/src/ui/ports/platform/pricing/page.browser.test.ts`
- `ui/src/ui/ports/port-shells.browser.test.ts`

### 构建

- `pnpm ui:build` 通过

### 运行态

- OpenBot 已重启并切换到最新 UI bundle
- 本地 gateway 监听恢复正常：`127.0.0.1:18789`

## 当前判断

本轮已完成的不是局部补丁，而是一轮面向结构稳定性的 UI 收敛：

- 企业端：减少冗余、减少英文残留、减少首屏无效负载
- 平台端：统一主模块与内部 tab 的刷新模型

当前平台端与企业端的主页面切换链路，均明显稳定于本轮开始前。

## 后续建议

1. 如需继续收口，可将企业端剩余混合术语与历史兼容说明再清一轮。
2. 平台端 `pricing` 仍保留“无宿主时兜底派发 popstate”的特例，可长期保留，也可未来通过更明确的 page-local rerender 机制替换。
3. 如准备发布或阶段封板，建议将本说明与相关 spec/task 交叉链接，作为阶段验收依据。
