/**
 * Browser-safe scrub of false 「可预览 / 可以直接打开」delivery claims.
 *
 * Control-ui must not import chat-deliverable-publish.ts: that module's
 * top-level graph pulls collaboration-learning/shared →
 * @openbot/collaboration-openbot-adapter, which Docker ui:build cannot resolve.
 */

const FALSE_DELIVERY_CLAIM_RE =
  /点预览就能打开|点预览即可|请(?:点击)?预览(?:打开|查看)?|可以直接打开|可直接打开|已可预览|文件已(?:生成|就绪)[，,]?\s*可(?:以)?(?:预览|打开)/gu;

/**
 * User-visible 「可预览 / 可以直接打开 / 已交付」copy is only honest when
 * presentation=delivered (settle success). Scrub false claims so chat never
 * says "click preview" while the card is missing/empty.
 */
export function scrubFalseDeliveryClaims(text: string): string {
  if (!text) {
    return text;
  }
  const nextRaw = text.replace(FALSE_DELIVERY_CLAIM_RE, "");
  if (nextRaw === text) {
    return text;
  }
  // Collapse doubled punctuation left by mid-sentence scrub.
  let next = nextRaw.replace(/([。.!！?？])\s*\1+/gu, "$1");
  next = next.replace(/([，,；;：:])\s*\1+/gu, "$1");
  next = next.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return next;
}
