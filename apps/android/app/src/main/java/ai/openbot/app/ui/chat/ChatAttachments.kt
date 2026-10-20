package ai.openbot.app.ui.chat

/**
 * Web-aligned chat attachment helpers.
 *
 * Mirrors `ui/src/ui/views/chat.ts` (`CHAT_ATTACHMENT_ACCEPT`, size caps,
 * `isSupportedAttachmentFile`) and `ui/src/ui/controllers/chat.ts`
 * (`apiAttachments` type = image | file).
 */
enum class PendingAttachmentStatus {
  Reading,
  Ready,
  Failed,
}

data class PendingChatAttachment(
  val id: String,
  val fileName: String,
  val mimeType: String,
  /** Gateway `attachments[].type`: "image" | "file". */
  val type: String,
  val base64: String? = null,
  val status: PendingAttachmentStatus = PendingAttachmentStatus.Ready,
  val progressPercent: Int? = null,
  val error: String? = null,
  val sizeBytes: Long? = null,
)

object ChatAttachmentLimits {
  /** Web `CHAT_IMAGE_ATTACHMENT_MAX_BYTES`. */
  const val IMAGE_MAX_BYTES = 10L * 1024L * 1024L

  /** Web `CHAT_FILE_ATTACHMENT_MAX_BYTES`. */
  const val FILE_MAX_BYTES = 25L * 1024L * 1024L

  const val MAX_COUNT = 8
}

/** MIME types for ActivityResultContracts.OpenMultipleDocuments. */
val CHAT_ATTACHMENT_MIME_TYPES: Array<String> =
  arrayOf(
    "image/*",
    "text/plain",
    "text/markdown",
    "text/html",
    "text/csv",
    "application/json",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  )

private val SUPPORTED_EXACT_MIME =
  setOf(
    "text/plain",
    "text/markdown",
    "text/html",
    "text/csv",
    "application/json",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  )

private val SUPPORTED_EXTENSION =
  Regex("""\.(txt|md|html?|csv|json|pdf|docx|xlsx|pptx)$""", RegexOption.IGNORE_CASE)

/** Web `isSupportedAttachmentFile`. */
fun isSupportedChatAttachment(mimeType: String?, fileName: String): Boolean {
  val mime = mimeType?.lowercase()?.trim().orEmpty()
  if (mime.startsWith("image/")) return true
  if (mime in SUPPORTED_EXACT_MIME) return true
  return SUPPORTED_EXTENSION.containsMatchIn(fileName)
}

/** Web controllers/chat.ts: image MIME → type "image", else "file". */
fun chatAttachmentTransportType(mimeType: String): String =
  if (mimeType.lowercase().startsWith("image/")) "image" else "file"

fun chatAttachmentMaxBytes(mimeType: String): Long =
  if (mimeType.lowercase().startsWith("image/")) {
    ChatAttachmentLimits.IMAGE_MAX_BYTES
  } else {
    ChatAttachmentLimits.FILE_MAX_BYTES
  }

fun formatAttachmentStatusLabel(att: PendingChatAttachment): String =
  when (att.status) {
    PendingAttachmentStatus.Reading ->
      att.progressPercent?.let { "上传中 $it%" } ?: "上传中"
    PendingAttachmentStatus.Ready -> "已添加，待发送"
    PendingAttachmentStatus.Failed -> att.error ?: "上传失败"
  }
