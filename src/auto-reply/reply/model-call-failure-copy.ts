/**
 * End-user copy for a model call that failed before any reply.
 * Never include provider ids, runtime ids, or log commands.
 */

const MODEL_CALL_FAILED_ZH = "这一轮没能调用已配置的模型。请到模型设置确认主模型可用，然后重试。";
const MODEL_CALL_FAILED_EN =
  "This turn could not call the configured model. Check that the primary model is available in model settings, then try again.";

export function isOpaqueModelCallFailure(message: string): boolean {
  return (
    /unknown model\b/i.test(message) ||
    /model_not_found/i.test(message) ||
    /enterprise byok/i.test(message) ||
    /enterprise model asset/i.test(message) ||
    /managed tenantId could not be resolved/i.test(message)
  );
}

export function buildUserFacingModelCallFailure(
  message: string,
  language?: string | null,
): string | null {
  if (!isOpaqueModelCallFailure(message)) {
    return null;
  }
  return language === "en" ? MODEL_CALL_FAILED_EN : MODEL_CALL_FAILED_ZH;
}
