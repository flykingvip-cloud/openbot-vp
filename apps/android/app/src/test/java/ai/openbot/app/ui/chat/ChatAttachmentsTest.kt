package ai.openbot.app.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors Web `ui/src/ui/views/chat.ts` attachment accept / type rules. */
class ChatAttachmentsTest {
  @Test
  fun acceptsImagesAndOfficeDocsLikeWeb() {
    assertTrue(isSupportedChatAttachment("image/png", "a.png"))
    assertTrue(isSupportedChatAttachment("image/jpeg", "photo.jpg"))
    assertTrue(isSupportedChatAttachment("application/pdf", "spec.pdf"))
    assertTrue(isSupportedChatAttachment("text/plain", "notes.txt"))
    assertTrue(isSupportedChatAttachment("application/json", "data.json"))
    assertTrue(
      isSupportedChatAttachment(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc.docx",
      ),
    )
    // Extension fallback when MIME is empty/octet-stream
    assertTrue(isSupportedChatAttachment("application/octet-stream", "slides.pptx"))
    assertTrue(isSupportedChatAttachment(null, "sheet.xlsx"))
  }

  @Test
  fun rejectsUnsupportedTypes() {
    assertFalse(isSupportedChatAttachment("application/zip", "archive.zip"))
    assertFalse(isSupportedChatAttachment("video/mp4", "clip.mp4"))
    assertFalse(isSupportedChatAttachment("application/octet-stream", "bin.dat"))
  }

  @Test
  fun transportTypeMatchesWebImageVsFile() {
    assertEquals("image", chatAttachmentTransportType("image/png"))
    assertEquals("image", chatAttachmentTransportType("image/webp"))
    assertEquals("file", chatAttachmentTransportType("application/pdf"))
    assertEquals("file", chatAttachmentTransportType("text/markdown"))
  }

  @Test
  fun sizeCapsMatchWeb() {
    assertEquals(10L * 1024 * 1024, chatAttachmentMaxBytes("image/png"))
    assertEquals(25L * 1024 * 1024, chatAttachmentMaxBytes("application/pdf"))
  }

  @Test
  fun statusLabelsMatchWebCopy() {
    val reading =
      PendingChatAttachment(
        id = "1",
        fileName = "a.png",
        mimeType = "image/png",
        type = "image",
        status = PendingAttachmentStatus.Reading,
        progressPercent = 40,
      )
    assertEquals("上传中 40%", formatAttachmentStatusLabel(reading))
    val ready = reading.copy(status = PendingAttachmentStatus.Ready, progressPercent = 100, base64 = "x")
    assertEquals("已添加，待发送", formatAttachmentStatusLabel(ready))
    val failed = reading.copy(status = PendingAttachmentStatus.Failed, error = "空文件")
    assertEquals("空文件", formatAttachmentStatusLabel(failed))
  }
}
