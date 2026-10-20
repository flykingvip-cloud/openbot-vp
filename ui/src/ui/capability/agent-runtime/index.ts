/**
 * Agent Runtime Center 模块导出索引。
 *
 * 该模块为 Platform Runtime Layer 的 Gateway 客户端面，统一以命名导出形式
 * 重新导出本目录下的所有公共符号：
 *
 * - `./endpoints.ts`       18 个 RPC 端点常量与 Request/Response 类型
 * - `./gateway-client.ts`  基于 GatewayBrowserClient 的类型化客户端工厂
 * - `./mock-backend.ts`    开发/测试用的内存 Mock 后端
 *
 * 调用方应仅从此 index 引入 agent-runtime 相关符号，便于后续在不破坏外部 API
 * 的前提下重组内部文件结构。
 *
 * 注意：本模块依赖 `runtime-canonical/`（上游纯类型层），**不可**反向被
 * `runtime-canonical/` 引入。
 */

export * from "./endpoints.ts";
export * from "./facade.ts";
export * from "./gateway-client.ts";
export * from "./mock-backend.ts";
