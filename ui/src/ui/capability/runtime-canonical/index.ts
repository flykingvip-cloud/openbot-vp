/**
 * Runtime Canonical Model — 模块导出索引。
 *
 * 该模块为 Platform Runtime Layer 的对外公共面，统一以命名导出形式重新导出
 * 本目录下的所有公共符号：
 *
 * - `./types.ts`                   纯类型定义（RuntimeAgent / Binding / Telemetry / GovernanceIssue 等）
 * - `./projection.ts`              Runtime → Enterprise / Employee 投影函数
 * - `./health-calculator.ts`       Telemetry → RuntimeHealth 纯函数计算器
 * - `./lifecycle-state-machine.ts` Runtime Lifecycle 状态机校验
 * - `./governance-detector.ts`     7 类运行时治理问题检测器
 *
 * 调用方应仅从此 index 引入 runtime-canonical 相关符号，以便后续在不破坏
 * 外部 API 的前提下重组内部文件结构。
 *
 * 注意：本模块为上游模块，**不可**反向依赖企业端 / 员工端 / Gateway 客户端等
 * 任何下游模块。
 */

export * from "./types.ts";
export * from "./projection.ts";
export * from "./health-calculator.ts";
export * from "./lifecycle-state-machine.ts";
export * from "./governance-detector.ts";
export * from "./terminology-guard.ts";
export * from "./event-bus.ts";
export * from "./cross-layer-wiring.ts";
export * from "./runtime-intelligence.ts";
