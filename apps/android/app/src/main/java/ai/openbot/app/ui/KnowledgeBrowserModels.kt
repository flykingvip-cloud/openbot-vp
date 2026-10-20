package ai.openbot.app.ui

import java.util.Base64
import ai.openbot.app.chat.ChatContextSourceCatalogItem
import ai.openbot.app.chat.ChatContextSourceKind
import ai.openbot.app.chat.ChatContextVisibility
import ai.openbot.app.chat.contextSourceKey
import java.nio.charset.Charset
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Knowledge tab browse helpers — same catalog model as Chat「知识库」capsule
 * (`ChatContextSourceCatalogItem` / `context.scope` / `knowledge.base.list`).
 *
 * Doc open mirrors Web `knowledge.document.preview`
 * (`ui/src/ui/controllers/knowledge-universe-document-reader.ts`).
 */
private val knowledgeJson = Json { ignoreUnknownKeys = true }

/** Debug evidence — seed SoT-shaped tree without gateway. */
const val DEMO_KNOWLEDGE_EXTRA = "ai.openbot.app.extra.DEMO_KNOWLEDGE"

data class KnowledgeOpenDocument(
  val item: ChatContextSourceCatalogItem,
  val knowledgeBaseId: String?,
)

sealed class KnowledgeDocumentBody {
  data object Loading : KnowledgeDocumentBody()

  data class Text(
    val title: String,
    val markdownOrPlain: String,
    val fromPreview: Boolean,
    /** Raw HTML from preview when present — UI may render WebView for fidelity. */
    val htmlSource: String? = null,
  ) : KnowledgeDocumentBody()

  data class Unavailable(
    val title: String,
    val reason: String,
  ) : KnowledgeDocumentBody()
}

/**
 * Walk parent chain to the owning knowledge base (Web reader needs kbId + documentId).
 */
fun resolveKnowledgeBaseId(
  item: ChatContextSourceCatalogItem,
  catalog: List<ChatContextSourceCatalogItem>,
): String? {
  if (item.type == ChatContextSourceKind.Knowledge) return item.id
  val byId = catalog.associateBy { it.id }
  var current: ChatContextSourceCatalogItem? = item
  val seen = mutableSetOf<String>()
  while (current != null) {
    val key = contextSourceKey(current)
    if (!seen.add(key)) return null
    val parentId = current.parentId?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val parent = byId[parentId] ?: return null
    if (parent.type == ChatContextSourceKind.Knowledge) return parent.id
    current = parent
  }
  return null
}

fun buildKnowledgeDocumentPreviewParams(
  knowledgeBaseId: String,
  documentId: String,
): String =
  buildJsonObject {
    put("knowledgeBaseId", knowledgeBaseId)
    put("documentId", documentId)
    put("render", true)
  }.toString()

/**
 * Parse `knowledge.document.preview` JSON → readable text.
 * Prefers `html`, then base64-decoded body (Web `decodeKnowledgeDocumentPreviewText`).
 */
fun parseKnowledgeDocumentPreviewPayload(
  payloadJson: String,
  fallbackTitle: String,
): KnowledgeDocumentBody.Text? {
  return try {
    val root = knowledgeJson.parseToJsonElement(payloadJson).asObjectOrNull() ?: return null
    val filename = root["filename"].asStringOrNull()?.trim().orEmpty()
    val title = filename.ifEmpty { fallbackTitle }
    val html = root["html"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() }
    if (html != null) {
      return KnowledgeDocumentBody.Text(
        title = title,
        markdownOrPlain = htmlToPlainApprox(html),
        fromPreview = true,
        htmlSource = html,
      )
    }
    val b64 = root["base64"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val decoded =
      try {
        String(Base64.getDecoder().decode(b64), Charset.forName("UTF-8"))
      } catch (_: Throwable) {
        return null
      }
    if (decoded.isBlank()) return null
    KnowledgeDocumentBody.Text(title = title, markdownOrPlain = decoded, fromPreview = true)
  } catch (_: Throwable) {
    null
  }
}

/** SoT stub body when preview RPC unavailable (offline / missing kb / gateway gap). */
fun knowledgeDocumentStubBody(title: String): KnowledgeDocumentBody.Text {
  val t = title.trim().ifEmpty { "文档" }
  return KnowledgeDocumentBody.Text(
    title = t,
    markdownOrPlain =
      """
      # $t

      ## 1. 入职准备
      请在入职首日 9:00 前携带相关证件到前台报到。公司将提供电脑与办公设备，IT 同学会协助完成账号开通。

      ## 2. 公司文化
      请阅读员工手册了解核心价值观。下午 HR 将介绍团队与工作流程，并安排导师结对。

      （预览占位 · 连接 Gateway 后将走 knowledge.document.preview）
      """.trimIndent(),
    fromPreview = false,
  )
}

/** Demo catalog shaped like four-tab SoT knowledge-tree (个人/团队/企业). */
val DEMO_KNOWLEDGE_CATALOG: List<ChatContextSourceCatalogItem> =
  listOf(
    ChatContextSourceCatalogItem(
      type = ChatContextSourceKind.Knowledge,
      id = "kb-personal-achievements",
      label = "个人成果",
      visibility = ChatContextVisibility.Private,
    ),
    ChatContextSourceCatalogItem(
      type = ChatContextSourceKind.File,
      id = "doc-onboarding",
      label = "入职流程手册",
      parentId = "kb-personal-achievements",
      visibility = ChatContextVisibility.Private,
    ),
    ChatContextSourceCatalogItem(
      type = ChatContextSourceKind.File,
      id = "doc-books",
      label = "图书",
      parentId = "kb-personal-achievements",
      visibility = ChatContextVisibility.Private,
    ),
    ChatContextSourceCatalogItem(
      type = ChatContextSourceKind.File,
      id = "doc-grok",
      label = "Grok Bot x OpenBot 能力对标与…",
      parentId = "kb-personal-achievements",
      visibility = ChatContextVisibility.Private,
    ),
    ChatContextSourceCatalogItem(
      type = ChatContextSourceKind.File,
      id = "doc-audit",
      label = "OpenBot 审计指导手册（中文版）",
      parentId = "kb-personal-achievements",
      visibility = ChatContextVisibility.Private,
    ),
    ChatContextSourceCatalogItem(
      type = ChatContextSourceKind.File,
      id = "doc-upbeyond",
      label = "UPBEYOND",
      parentId = "kb-personal-achievements",
      visibility = ChatContextVisibility.Private,
    ),
    ChatContextSourceCatalogItem(
      type = ChatContextSourceKind.Knowledge,
      id = "kb-ai-apps",
      label = "AI应用",
      visibility = ChatContextVisibility.Private,
    ),
    ChatContextSourceCatalogItem(
      type = ChatContextSourceKind.File,
      id = "doc-ai-list",
      label = "AI 应用清单",
      parentId = "kb-ai-apps",
      visibility = ChatContextVisibility.Private,
    ),
    ChatContextSourceCatalogItem(
      type = ChatContextSourceKind.Knowledge,
      id = "kb-team-achievements",
      label = "团队成果",
      visibility = ChatContextVisibility.Team,
    ),
    ChatContextSourceCatalogItem(
      type = ChatContextSourceKind.File,
      id = "doc-ai-org",
      label = "ai-org-report.pdf",
      parentId = "kb-team-achievements",
      visibility = ChatContextVisibility.Team,
    ),
    ChatContextSourceCatalogItem(
      type = ChatContextSourceKind.File,
      id = "doc-weekly",
      label = "一切都刚刚开始_第128期综述_发…",
      parentId = "kb-team-achievements",
      visibility = ChatContextVisibility.Team,
    ),
    ChatContextSourceCatalogItem(
      type = ChatContextSourceKind.Knowledge,
      id = "kb-external",
      label = "外部知识源",
      visibility = ChatContextVisibility.Enterprise,
    ),
    ChatContextSourceCatalogItem(
      type = ChatContextSourceKind.File,
      id = "doc-external",
      label = "外部知识源说明",
      parentId = "kb-external",
      visibility = ChatContextVisibility.Enterprise,
    ),
  )


data class KnowledgeSearchHit(
  val id: String,
  val title: String,
  val summary: String,
  val knowledgeBaseId: String?,
)

fun buildKnowledgeSearchParams(query: String, limit: Int = 20): String =
  buildJsonObject {
    put("query", query)
    put("limit", limit)
  }.toString()

fun parseKnowledgeSearchResults(raw: String): List<KnowledgeSearchHit> {
  return try {
    val root = knowledgeJson.parseToJsonElement(raw).asObjectOrNull() ?: return emptyList()
    val results = root["results"]?.let { it as? kotlinx.serialization.json.JsonArray } ?: return emptyList()
    results.mapNotNull { el ->
      val obj = el as? JsonObject ?: return@mapNotNull null
      val id = obj["id"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
      val title = obj["title"].asStringOrNull()?.trim().orEmpty().ifEmpty { id }
      val summary = obj["summary"].asStringOrNull()?.trim().orEmpty()
      val kbId =
        obj["knowledgeBaseId"].asStringOrNull()
          ?: obj["kbId"].asStringOrNull()
          ?: (obj["source"] as? JsonObject)?.get("knowledgeBaseId").asStringOrNull()
      KnowledgeSearchHit(id = id, title = title, summary = summary, knowledgeBaseId = kbId)
    }
  } catch (_: Throwable) {
    emptyList()
  }
}

/** Mirror Web `knowledge-universe-ui-prefs` favoriteKnowledgeBaseIds (client prefs). */
object KnowledgeFavoritePrefs {
  private const val PREFS = "openbot_knowledge_ui_prefs"
  private const val KEY = "favoriteKnowledgeBaseIds"

  fun readIds(context: android.content.Context): Set<String> {
    val raw = context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE).getString(KEY, "") ?: ""
    return raw.split(',').map { it.trim() }.filter { it.isNotEmpty() }.toSet()
  }

  fun toggle(context: android.content.Context, kbId: String): Set<String> {
    val id = kbId.trim()
    if (id.isEmpty()) return readIds(context)
    val cur = readIds(context).toMutableSet()
    if (!cur.add(id)) cur.remove(id)
    context
      .getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
      .edit()
      .putString(KEY, cur.joinToString(","))
      .apply()
    return cur
  }
}

private fun htmlToPlainApprox(html: String): String {
  return html
    .replace(Regex("(?is)<script[^>]*>.*?</script>"), "")
    .replace(Regex("(?is)<style[^>]*>.*?</style>"), "")
    .replace(Regex("(?i)<br\\s*/?>"), "\n")
    .replace(Regex("(?i)</p>"), "\n\n")
    .replace(Regex("(?i)</h[1-6]>"), "\n\n")
    .replace(Regex("(?i)<li[^>]*>"), "• ")
    .replace(Regex("(?i)</li>"), "\n")
    .replace(Regex("<[^>]+>"), "")
    .replace(Regex("&nbsp;"), " ")
    .replace(Regex("&amp;"), "&")
    .replace(Regex("&lt;"), "<")
    .replace(Regex("&gt;"), ">")
    .replace(Regex("\n{3,}"), "\n\n")
    .trim()
}

private fun JsonElement?.asObjectOrNull(): JsonObject? = this as? JsonObject

private fun JsonElement?.asStringOrNull(): String? =
  when (this) {
    is JsonNull -> null
    is JsonPrimitive -> content
    else -> null
  }
