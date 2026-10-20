package ai.openbot.app.employeeshell

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import java.util.concurrent.atomic.AtomicReference

/**
 * Storage Access Framework bridge for `<input type="file">` inside the employee
 * shell WebView.
 *
 * `ACTION_OPEN_DOCUMENT` returns content URIs with a temporary read grant to this
 * app. It does **not** need `READ_EXTERNAL_STORAGE` or `READ_MEDIA_*` — those
 * grants do not cover archives, and requesting them would not make the picker
 * work. This matches the native chat composer's `OpenMultipleDocuments` picker.
 */
object EmployeeShellFileChooser {
  private val MIME_TYPE =
    Regex("""^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9*][A-Za-z0-9!#$&^_.+-]*$""")

  private val EXTENSION_MIME =
    mapOf(
      "txt" to "text/plain",
      "md" to "text/markdown",
      "html" to "text/html",
      "htm" to "text/html",
      "csv" to "text/csv",
      "json" to "application/json",
      "pdf" to "application/pdf",
      "docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "pptx" to "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "zip" to "application/zip",
      "rar" to "application/vnd.rar",
      "7z" to "application/x-7z-compressed",
      "tar" to "application/x-tar",
      "gz" to "application/gzip",
      "tgz" to "application/gzip",
      "png" to "image/png",
      "jpg" to "image/jpeg",
      "jpeg" to "image/jpeg",
      "gif" to "image/gif",
      "webp" to "image/webp",
      "heic" to "image/heic",
    )

  /**
   * MIME types suitable for `EXTRA_MIME_TYPES`. A lone wildcard MIME means the
   * picker should not filter. Unknown tokens are dropped; if nothing survives, the
   * picker still opens unfiltered so cancel/select can complete.
   */
  fun normalizeAcceptTypes(acceptTypes: Array<String>?): List<String> {
    if (acceptTypes == null) return listOf("*/*")
    val tokens =
      acceptTypes
        .flatMap { it.split(',') }
        .map { it.trim() }
        .filter { it.isNotEmpty() }
    if (tokens.isEmpty()) return listOf("*/*")
    if (tokens.any { it == "*" || it.equals("*/*", ignoreCase = true) }) return listOf("*/*")
    val mapped = LinkedHashSet<String>()
    for (token in tokens) {
      mimeForToken(token)?.let { mapped.add(it) }
    }
    if (mapped.isEmpty()) return listOf("*/*")
    return mapped.toList()
  }

  fun openDocumentIntent(acceptTypes: Array<String>?, allowMultiple: Boolean): Intent {
    val mimeTypes = normalizeAcceptTypes(acceptTypes)
    val intent =
      Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (mimeTypes.size == 1) {
          type = mimeTypes[0]
        } else {
          type = "*/*"
          putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toTypedArray())
        }
        if (allowMultiple) {
          putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
      }
    return intent
  }

  /**
   * URIs to pass to [ValueCallback]. `null` means the user cancelled or the picker
   * returned nothing — WebView treats that as cancel, not as an empty selection.
   * When the input is not `multiple`, only the first URI is returned.
   */
  fun urisFromResult(resultCode: Int, data: Intent?, allowMultiple: Boolean): Array<Uri>? {
    if (resultCode != Activity.RESULT_OK || data == null) return null
    val collected = ArrayList<Uri>()
    val clip: ClipData? = data.clipData
    if (clip != null) {
      for (index in 0 until clip.itemCount) {
        clip.getItemAt(index)?.uri?.let { collected.add(it) }
      }
    }
    if (collected.isEmpty()) {
      data.data?.let { collected.add(it) }
    }
    if (collected.isEmpty()) return null
    val chosen = if (allowMultiple) collected else collected.take(1)
    return chosen.toTypedArray()
  }

  private fun mimeForToken(token: String): String? {
    val normalized = token.trim().lowercase()
    if (normalized == ".tar.gz" || normalized == "tar.gz") return "application/gzip"
    if (MIME_TYPE.matches(normalized)) return normalized
    val extension =
      when {
        normalized.startsWith(".") -> normalized.removePrefix(".")
        !normalized.contains("/") -> normalized
        else -> return null
      }
    if (extension.isEmpty() || extension.contains("/")) return null
    return EXTENSION_MIME[extension]
  }
}

/**
 * Owns the single in-flight [ValueCallback]. Chromium requires it to be invoked
 * exactly once. A newer chooser, a failed launch, or disposal cancels the previous
 * callback with `null`.
 */
class EmployeeShellFileChooserSession {
  private class Pending(
    val callback: ValueCallback<Array<Uri>>,
    val allowMultiple: Boolean,
  )

  private val pending = AtomicReference<Pending?>(null)

  fun begin(callback: ValueCallback<Array<Uri>>, allowMultiple: Boolean) {
    pending.getAndSet(Pending(callback, allowMultiple))?.callback?.onReceiveValue(null)
  }

  fun finish(resultCode: Int, data: Intent?) {
    val current = pending.getAndSet(null) ?: return
    current.callback.onReceiveValue(
      EmployeeShellFileChooser.urisFromResult(resultCode, data, current.allowMultiple),
    )
  }

  fun cancel() {
    pending.getAndSet(null)?.callback?.onReceiveValue(null)
  }
}

internal class EmployeeShellChromeClient(
  private val session: EmployeeShellFileChooserSession,
  private val launch: (Intent) -> Unit,
) : WebChromeClient() {
  override fun onShowFileChooser(
    webView: WebView?,
    filePathCallback: ValueCallback<Array<Uri>>?,
    fileChooserParams: FileChooserParams?,
  ): Boolean {
    if (filePathCallback == null) return false
    val multiple = fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE
    val intent = EmployeeShellFileChooser.openDocumentIntent(fileChooserParams?.acceptTypes, multiple)
    session.begin(filePathCallback, multiple)
    return try {
      launch(intent)
      true
    } catch (_: RuntimeException) {
      // Launch failed (no DocumentsUI, or the activity-result launcher is gone).
      // The callback was already taken, so report cancel instead of leaving the
      // page's file input stuck.
      session.cancel()
      true
    }
  }
}
