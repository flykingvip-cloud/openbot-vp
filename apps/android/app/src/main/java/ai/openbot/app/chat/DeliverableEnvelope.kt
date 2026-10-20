package ai.openbot.app.chat

/**
 * Deliverable output envelope — port of Web `ui/src/ui/chat/deliverable-envelope.ts`.
 *
 * Priority: `<<DELIVERABLE attrs>>…<</DELIVERABLE>>` (preferred) over `「…」` quotes.
 * Stage 25 MVP only surfaces footers for **located** tagged envelopes (file= and/or url=).
 */
data class DeliverableEnvelope(
  val kind: Kind,
  val title: String? = null,
  val type: String? = null,
  val version: String? = null,
  val logicalId: String? = null,
  val file: String? = null,
  val url: String? = null,
  val body: String = "",
) {
  enum class Kind { Tag, Quoted }

  fun declaresLocation(): Boolean = !file.isNullOrBlank() || !url.isNullOrBlank()

  /** Left-side footer label: title, else file basename, else url host-ish. */
  fun targetLabel(): String {
    title?.takeIf { it.isNotBlank() }?.let { return it }
    file?.substringAfterLast('/')?.takeIf { it.isNotBlank() }?.let { return it }
    url?.let { u ->
      val trimmed = u.removePrefix("https://").removePrefix("http://")
      return trimmed.take(40).ifBlank { u.take(40) }
    }
    return ""
  }
}

data class DeliverableEnvelopeAttributes(
  val title: String? = null,
  val type: String? = null,
  val version: String? = null,
  val logicalId: String? = null,
  val file: String? = null,
  val url: String? = null,
)

private val TAGGED_DELIVERABLE_RE =
  Regex("""<<\s*DELIVERABLE\b([^>]*)>+([\s\S]*?)<<\s*/\s*DELIVERABLE\s*>>""", RegexOption.IGNORE_CASE)

private val QUOTED_DELIVERABLE_RE = Regex("""「([\s\S]*?)」""")

private const val MIN_ENVELOPE_BODY_CHARS = 20
private const val MAX_WORKSPACE_RELATIVE_PATH_CHARS = 500
private const val MIN_QUOTED_ENVELOPE_COVERAGE = 0.6

fun normalizeDeliverableWorkspacePath(value: String): String? {
  val normalized = value.trim().replace('\\', '/')
  if (
    normalized.isEmpty() ||
      normalized.length > MAX_WORKSPACE_RELATIVE_PATH_CHARS ||
      normalized.startsWith("/") ||
      normalized.endsWith("/") ||
      normalized.contains('\u0000') ||
      Regex("""^[a-z]:/""", RegexOption.IGNORE_CASE).containsMatchIn(normalized)
  ) {
    return null
  }
  val segments = normalized.split('/')
  if (segments.any { seg -> seg.isEmpty() || seg == "." || seg == ".." || seg.contains(':') }) {
    return null
  }
  return segments.joinToString("/")
}

fun parseDeliverableAttributes(block: String): DeliverableEnvelopeAttributes {
  var title: String? = null
  var type: String? = null
  var version: String? = null
  var logicalId: String? = null
  var file: String? = null
  var url: String? = null
  val attrRe = Regex("""([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""")
  for (match in attrRe.findAll(block)) {
    val key = (match.groupValues.getOrNull(1) ?: "").lowercase()
    val value =
      (match.groupValues.getOrNull(2)
          ?: match.groupValues.getOrNull(3)
          ?: match.groupValues.getOrNull(4)
          ?: "")
        .trim()
    if (value.isEmpty()) continue
    when (key) {
      "title" -> title = value.take(80)
      "type" -> type = value.take(40)
      "version" -> version = value.take(16)
      "logicalid", "logical_id", "id" -> logicalId = value.take(80)
      "file", "path", "filename" -> {
        val workspacePath = normalizeDeliverableWorkspacePath(value)
        if (workspacePath != null) file = workspacePath
      }
      "url" -> {
        if (value.matches(Regex("""^https?://.*""", RegexOption.IGNORE_CASE))) {
          url = value.take(2000)
        }
      }
    }
  }
  return DeliverableEnvelopeAttributes(
    title = title,
    type = type,
    version = version,
    logicalId = logicalId,
    file = file,
    url = url,
  )
}

private fun normalizeEnvelopeBody(body: String): String = body.trim()

private fun normalizeEnvelopeTitle(title: String?): String? {
  val trimmed = title?.trim().orEmpty()
  return if (trimmed.isEmpty()) null else trimmed.take(80)
}

private fun buildTaggedEnvelope(attrBlock: String, rawBody: String): DeliverableEnvelope? {
  val body = normalizeEnvelopeBody(rawBody)
  val attrs = parseDeliverableAttributes(attrBlock)
  if (body.isEmpty() && attrs.file.isNullOrBlank() && attrs.url.isNullOrBlank()) {
    return null
  }
  return DeliverableEnvelope(
    kind = DeliverableEnvelope.Kind.Tag,
    title = normalizeEnvelopeTitle(attrs.title),
    type = attrs.type,
    version = attrs.version,
    logicalId = attrs.logicalId?.trim()?.takeIf { it.isNotEmpty() },
    file = attrs.file,
    url = attrs.url,
    body = body,
  )
}

fun extractTaggedDeliverableEnvelopes(text: String): List<DeliverableEnvelope> {
  val envelopes = mutableListOf<DeliverableEnvelope>()
  for (match in TAGGED_DELIVERABLE_RE.findAll(text)) {
    val envelope = buildTaggedEnvelope(match.groupValues.getOrElse(1) { "" }, match.groupValues.getOrElse(2) { "" })
    if (envelope != null) envelopes.add(envelope)
  }
  return envelopes
}

fun extractQuotedDeliverableEnvelopes(text: String): List<DeliverableEnvelope> {
  val envelopes = mutableListOf<DeliverableEnvelope>()
  for (match in QUOTED_DELIVERABLE_RE.findAll(text)) {
    val body = normalizeEnvelopeBody(match.groupValues.getOrElse(1) { "" })
    if (body.isEmpty()) continue
    envelopes.add(DeliverableEnvelope(kind = DeliverableEnvelope.Kind.Quoted, body = body))
  }
  return envelopes
}

private fun envelopeLocationKey(entry: DeliverableEnvelope): String? {
  entry.file?.let { return "file:$it" }
  entry.url?.let { return "url:$it" }
  return null
}

/** Tagged envelopes that declare file/url, document order, de-duped by location. */
fun extractLocatedDeliverableEnvelopes(text: String): List<DeliverableEnvelope> {
  val seen = mutableSetOf<String>()
  val located = mutableListOf<DeliverableEnvelope>()
  for (envelope in extractTaggedDeliverableEnvelopes(text)) {
    if (!envelope.declaresLocation()) continue
    val key = envelopeLocationKey(envelope) ?: continue
    if (!seen.add(key)) continue
    located.add(envelope)
  }
  return located
}

private fun pickBestEnvelope(candidates: List<DeliverableEnvelope>): DeliverableEnvelope? {
  val eligible =
    candidates.filter {
      it.declaresLocation() || normalizeEnvelopeBody(it.body).length >= MIN_ENVELOPE_BODY_CHARS
    }
  if (eligible.isEmpty()) return null
  return eligible.reduce { best, current ->
    val currentLocated = current.declaresLocation()
    val bestLocated = best.declaresLocation()
    when {
      currentLocated != bestLocated -> if (currentLocated) current else best
      normalizeEnvelopeBody(current.body).length > normalizeEnvelopeBody(best.body).length -> current
      else -> best
    }
  }
}

private fun isDominantQuotedEnvelope(body: String, text: String): Boolean {
  val totalLength = text.trim().length
  if (totalLength == 0) return false
  return normalizeEnvelopeBody(body).length.toDouble() / totalLength >= MIN_QUOTED_ENVELOPE_COVERAGE
}

/** Best deliverable envelope in [text], or null. */
fun extractDeliverableEnvelope(text: String): DeliverableEnvelope? {
  val located = extractLocatedDeliverableEnvelopes(text)
  when {
    located.size == 1 -> return located[0]
    located.size > 1 -> return pickBestEnvelope(located)
  }
  val taggedBest = pickBestEnvelope(extractTaggedDeliverableEnvelopes(text))
  if (taggedBest != null) return taggedBest
  val quotedBest = pickBestEnvelope(extractQuotedDeliverableEnvelopes(text))
  return if (quotedBest != null && isDominantQuotedEnvelope(quotedBest.body, text)) quotedBest else null
}

/**
 * Strip machine envelopes from assistant markdown for display.
 * Replaces each tagged block with its body (keeps surrounding prose / tables).
 */
fun stripDeliverableEnvelopeTags(text: String): String {
  return TAGGED_DELIVERABLE_RE.replace(text) { match ->
    normalizeEnvelopeBody(match.groupValues.getOrElse(2) { "" })
  }.trim()
}
