package ai.openbot.app.employeeshell

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.webkit.ValueCallback
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EmployeeShellFileChooserTest {
  @Test
  fun blankAcceptOpensUnfilteredDocumentPicker() {
    val intent = EmployeeShellFileChooser.openDocumentIntent(null, allowMultiple = false)
    assertEquals(Intent.ACTION_OPEN_DOCUMENT, intent.action)
    assertEquals("*/*", intent.type)
    assertNull(intent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES))
    assertFalse(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false))
    assertTrue(intent.hasCategory(Intent.CATEGORY_OPENABLE))
    assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
  }

  @Test
  fun chatAcceptMapsExtensionsAndKeepsMultiple() {
    val intent =
      EmployeeShellFileChooser.openDocumentIntent(
        arrayOf("image/*,application/pdf,.zip,.rar,.7z,.tar.gz"),
        allowMultiple = true,
      )
    assertEquals("*/*", intent.type)
    assertTrue(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false))
    val mimes = intent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES)!!.toList()
    assertTrue(mimes.contains("image/*"))
    assertTrue(mimes.contains("application/pdf"))
    assertTrue(mimes.contains("application/zip"))
    assertTrue(mimes.contains("application/vnd.rar"))
    assertTrue(mimes.contains("application/x-7z-compressed"))
    assertTrue(mimes.contains("application/gzip"))
  }

  @Test
  fun singleMimeDoesNotNeedExtraList() {
    val intent = EmployeeShellFileChooser.openDocumentIntent(arrayOf("application/pdf"), false)
    assertEquals("application/pdf", intent.type)
    assertNull(intent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES))
  }

  @Test
  fun wildcardCollapsesFilter() {
    assertEquals(listOf("*/*"), EmployeeShellFileChooser.normalizeAcceptTypes(arrayOf("image/*", "*/*")))
    assertEquals(listOf("*/*"), EmployeeShellFileChooser.normalizeAcceptTypes(arrayOf("")))
    assertEquals(listOf("application/zip"), EmployeeShellFileChooser.normalizeAcceptTypes(arrayOf("not a mime", ".zip")))
  }

  @Test
  fun cancelAndEmptyResultAreNull() {
    assertNull(EmployeeShellFileChooser.urisFromResult(Activity.RESULT_CANCELED, null, true))
    assertNull(EmployeeShellFileChooser.urisFromResult(Activity.RESULT_OK, Intent(), true))
    assertNull(EmployeeShellFileChooser.urisFromResult(Activity.RESULT_CANCELED, Intent(), false))
  }

  @Test
  fun clipDataKeepsEveryUriOnlyWhenMultiple() {
    val first = Uri.parse("content://files/a")
    val second = Uri.parse("content://files/b")
    val clip = ClipData("files", arrayOf("*/*"), ClipData.Item(first))
    clip.addItem(ClipData.Item(second))
    val data = Intent().apply { clipData = clip }
    val many = EmployeeShellFileChooser.urisFromResult(Activity.RESULT_OK, data, allowMultiple = true)
    assertEquals(listOf(first, second), many!!.toList())
    val one = EmployeeShellFileChooser.urisFromResult(Activity.RESULT_OK, data, allowMultiple = false)
    assertEquals(listOf(first), one!!.toList())
  }

  @Test
  fun singleDataUriIsReturned() {
    val uri = Uri.parse("content://files/one")
    val data = Intent().apply { this.data = uri }
    val uris = EmployeeShellFileChooser.urisFromResult(Activity.RESULT_OK, data, allowMultiple = false)
    assertEquals(listOf(uri), uris!!.toList())
  }

  @Test
  fun chooserLaunchesOpenDocumentAndCancelInvokesCallbackOnce() {
    val session = EmployeeShellFileChooserSession()
    var launched: Intent? = null
    val client = EmployeeShellChromeClient(session) { launched = it }
    val callback = RecordingCallback()
    assertTrue(client.onShowFileChooser(null, callback, null))
    assertEquals(Intent.ACTION_OPEN_DOCUMENT, launched?.action)
    session.finish(Activity.RESULT_CANCELED, null)
    assertEquals(1, callback.values.size)
    assertNull(callback.values[0])
    session.finish(Activity.RESULT_OK, Intent())
    assertEquals(1, callback.values.size)
  }

  @Test
  fun secondChooserCancelsTheFirstCallback() {
    val session = EmployeeShellFileChooserSession()
    val client = EmployeeShellChromeClient(session) { _ -> }
    val first = RecordingCallback()
    val second = RecordingCallback()
    client.onShowFileChooser(null, first, null)
    client.onShowFileChooser(null, second, null)
    assertEquals(listOf<Array<Uri>?>(null), first.values)
    session.cancel()
    assertEquals(listOf<Array<Uri>?>(null), second.values)
    assertEquals(1, first.values.size)
  }

  @Test
  fun failedLaunchReportsCancel() {
    val session = EmployeeShellFileChooserSession()
    val client =
      EmployeeShellChromeClient(session) {
        throw IllegalStateException("launcher gone")
      }
    val callback = RecordingCallback()
    assertTrue(client.onShowFileChooser(null, callback, null))
    assertEquals(listOf<Array<Uri>?>(null), callback.values)
  }

  @Test
  fun nullCallbackIsNotHandled() {
    val client = EmployeeShellChromeClient(EmployeeShellFileChooserSession()) {}
    assertFalse(client.onShowFileChooser(null, null, null))
  }

  private class RecordingCallback : ValueCallback<Array<Uri>> {
    val values = mutableListOf<Array<Uri>?>()

    override fun onReceiveValue(value: Array<Uri>?) {
      values.add(value)
    }
  }
}
