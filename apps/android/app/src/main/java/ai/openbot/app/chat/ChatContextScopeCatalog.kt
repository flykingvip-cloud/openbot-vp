package ai.openbot.app.chat

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Android port of Web `ui/src/ui/chat/context-scope-catalog.ts` parsers.
 * Gateway RPCs: `context.scope.sources.catalog` → fallback `knowledge.base.list`
 * (+ nested `knowledge.base.sources.list`).
 */

private val SOURCE_KINDS = setOf("knowledge", "file", "folder", "api")
private val VISIBILITIES = setOf("private", "team", "enterprise")
private val API_KINDS = setOf("api", "external", "capability")
private val FOLDER_KINDS = setOf("localFolder", "gitRepo", "cloudDrive", "mailAttachment")

private const val LIMIT_KNOWLEDGE = 50
private const val LIMIT_FILES = 80
private const val LIMIT_FOLDERS = 40
private const val LIMIT_APIS = 40

fun parseContextScopeCatalogJson(json: Json, raw: String): List<ChatContextSourceCatalogItem> {
  return try {
    val el = json.parseToJsonElement(raw)
    val root = el.asObjectOrNull()
    val sources = root?.get("sources").asArrayOrNull() ?: el.asArrayOrNull()
    parseContextScopeCatalog(sources)
  } catch (_: Throwable) {
    emptyList()
  }
}

fun parseContextScopeCatalog(raw: JsonArray?): List<ChatContextSourceCatalogItem> {
  if (raw == null) return emptyList()
  val items = mutableListOf<ChatContextSourceCatalogItem>()
  for (entry in raw) {
    val record = entry.asObjectOrNull() ?: continue
    val type = record["type"].asStringOrNull()?.trim().orEmpty()
    val id = record["id"].asStringOrNull()?.trim().orEmpty()
    val label = record["label"].asStringOrNull()?.trim().orEmpty()
    if (type !in SOURCE_KINDS || id.isEmpty() || label.isEmpty()) continue
    val visibility = record["visibility"].asStringOrNull()?.trim()?.takeIf { it in VISIBILITIES }
    items.add(
      ChatContextSourceCatalogItem(
        type = parseKind(type) ?: continue,
        id = id,
        label = label,
        parentId = record["parentId"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() },
        subtitle = record["subtitle"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() },
        visibility = visibility?.let(::parseVisibility),
        hasConflict = record["hasConflict"].asBooleanOrNull() == true,
      ),
    )
  }
  return items
}

fun parseKnowledgeBaseListCatalog(json: Json, raw: String): List<ChatContextSourceCatalogItem> {
  return try {
    val el = json.parseToJsonElement(raw)
    val root = el.asObjectOrNull()
    val list = root?.get("knowledgeBases").asArrayOrNull() ?: el.asArrayOrNull() ?: return emptyList()
    val items = mutableListOf<ChatContextSourceCatalogItem>()
    for (entry in list) {
      if (items.size >= LIMIT_KNOWLEDGE) break
      val item = entry.asObjectOrNull() ?: continue
      val id =
        item["id"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() }
          ?: item["knowledgeBaseId"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() }
          ?: continue
      val label =
        item["title"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() }
          ?: item["label"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() }
          ?: continue
      val visibility = item["visibility"].asStringOrNull()?.trim()?.takeIf { it in VISIBILITIES }
      val hasConflict =
        item["hasConflict"].asBooleanOrNull() == true ||
          item["governanceStatus"].asStringOrNull() == "conflict" ||
          ((item["conflictCount"].asLongOrNull() ?: 0L) > 0L)
      items.add(
        ChatContextSourceCatalogItem(
          type = ChatContextSourceKind.Knowledge,
          id = id,
          label = label,
          visibility = visibility?.let(::parseVisibility),
          hasConflict = hasConflict,
        ),
      )
    }
    items
  } catch (_: Throwable) {
    emptyList()
  }
}

fun parseKnowledgeBaseSourcesCatalog(
  parent: ChatContextSourceCatalogItem,
  json: Json,
  raw: String,
): List<ChatContextSourceCatalogItem> {
  return try {
    val el = json.parseToJsonElement(raw)
    val root = el.asObjectOrNull()
    val list = root?.get("sources").asArrayOrNull() ?: el.asArrayOrNull() ?: return emptyList()
    val items = mutableListOf<ChatContextSourceCatalogItem>()
    var files = 0
    var folders = 0
    var apis = 0
    for (entry in list) {
      val item = entry.asObjectOrNull() ?: continue
      val kind = item["kind"].asStringOrNull()?.trim().orEmpty()
      val id =
        item["documentId"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() }
          ?: item["id"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() }
          ?: item["sourceDescriptorId"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() }
          ?: continue
      val label =
        item["title"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() }
          ?: item["label"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() }
          ?: continue
      val visibility =
        item["visibility"].asStringOrNull()?.trim()?.takeIf { it in VISIBILITIES }?.let(::parseVisibility)
          ?: parent.visibility
      when {
        kind in API_KINDS -> {
          if (apis >= LIMIT_APIS) continue
          apis += 1
          items.add(
            ChatContextSourceCatalogItem(
              type = ChatContextSourceKind.Api,
              id = id,
              label = label,
              parentId = parent.id,
              visibility = visibility,
              subtitle = item["formatLabel"].asStringOrNull()?.trim()?.takeIf { it.isNotEmpty() },
            ),
          )
        }
        kind in FOLDER_KINDS -> {
          if (folders >= LIMIT_FOLDERS) continue
          folders += 1
          items.add(
            ChatContextSourceCatalogItem(
              type = ChatContextSourceKind.Folder,
              id = id,
              label = label,
              parentId = parent.id,
              visibility = visibility,
            ),
          )
        }
        else -> {
          if (files >= LIMIT_FILES) continue
          files += 1
          items.add(
            ChatContextSourceCatalogItem(
              type = ChatContextSourceKind.File,
              id = id,
              label = label,
              parentId = parent.id,
              visibility = visibility,
            ),
          )
        }
      }
    }
    items
  } catch (_: Throwable) {
    emptyList()
  }
}

private fun parseKind(raw: String): ChatContextSourceKind? =
  when (raw) {
    "knowledge" -> ChatContextSourceKind.Knowledge
    "file" -> ChatContextSourceKind.File
    "folder" -> ChatContextSourceKind.Folder
    "api" -> ChatContextSourceKind.Api
    else -> null
  }

private fun parseVisibility(raw: String): ChatContextVisibility =
  when (raw) {
    "team" -> ChatContextVisibility.Team
    "enterprise" -> ChatContextVisibility.Enterprise
    else -> ChatContextVisibility.Private
  }

private fun JsonElement?.asObjectOrNull(): JsonObject? = this as? JsonObject

private fun JsonElement?.asArrayOrNull(): JsonArray? = this as? JsonArray

private fun JsonElement?.asStringOrNull(): String? =
  when (this) {
    is JsonNull -> null
    is JsonPrimitive -> content
    else -> null
  }

private fun JsonElement?.asBooleanOrNull(): Boolean? =
  when (this) {
    is JsonPrimitive -> content.toBooleanStrictOrNull() ?: if (content == "true") true else if (content == "false") false else null
    else -> null
  }

private fun JsonElement?.asLongOrNull(): Long? =
  when (this) {
    is JsonPrimitive -> content.toLongOrNull()
    else -> null
  }
