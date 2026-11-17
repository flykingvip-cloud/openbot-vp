/**
 * Compatibility re-export. Official DeepSeek credential resolution and HTTP
 * completion live in the model adapter boundary. This command file does not
 * parse credentials or send HTTP itself.
 */
export {
  OFFICIAL_DEEPSEEK_BASE_URL,
  OFFICIAL_DEEPSEEK_MODEL,
  OFFICIAL_DEEPSEEK_PROVIDER,
  isOfficialDeepSeekApiBaseUrl,
  resolveOfficialDeepSeekCredential,
  createOfficialDeepSeekShadowCompletion,
  type OfficialDeepSeekCredential,
} from "../../model/rule-adaptation/official-deepseek-complete.js";
