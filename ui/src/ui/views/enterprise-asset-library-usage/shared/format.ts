/**
 * Format re-exports — 便捷入口，避免视图文件使用深层相对路径。
 *
 * 所有格式化函数的规范实现位于 `ui/src/ui/capability/runtime-projection/format.ts`，
 * 本文件仅做 re-export。
 */

export {
  FORMAT_NO_DATA_PLACEHOLDER,
  formatSuccessRate,
  formatExecutions,
  formatHealthStatus,
  formatLastActiveAt,
} from "../../../capability/runtime-projection/format.ts";
