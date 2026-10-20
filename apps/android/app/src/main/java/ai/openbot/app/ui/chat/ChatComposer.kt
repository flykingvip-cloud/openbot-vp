package ai.openbot.app.ui.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.openbot.app.ui.mobileAccent
import ai.openbot.app.ui.mobileAccentSoft
import ai.openbot.app.ui.mobileBorder
import ai.openbot.app.ui.mobileBorderStrong
import ai.openbot.app.ui.mobileCaption1
import ai.openbot.app.ui.mobileText
import ai.openbot.app.ui.mobileTextSecondary
import ai.openbot.app.ui.mobileTextTertiary

/** Vibrant red send — Web / SoT composer. */
private val sendRed = Color(0xFFE23B3B)
private val sendRedDisabled = Color(0xFFE8A0A0)

@Composable
fun ChatComposer(
  healthOk: Boolean,
  pendingRunCount: Int,
  attachments: List<PendingChatAttachment>,
  onPickAttachments: () -> Unit,
  onRemoveAttachment: (id: String) -> Unit,
  onSend: (text: String) -> Unit,
  onAbort: () -> Unit = {},
  onMicClick: (() -> Unit)? = null,
) {
  var input by rememberSaveable { mutableStateOf("") }

  val attachmentsBusy = attachments.any { it.status == PendingAttachmentStatus.Reading }
  val readyAttachments = attachments.filter { it.status == PendingAttachmentStatus.Ready && !it.base64.isNullOrEmpty() }
  val canSend =
    pendingRunCount == 0 &&
      !attachmentsBusy &&
      (input.trim().isNotEmpty() || readyAttachments.isNotEmpty()) &&
      healthOk
  val sendBusy = pendingRunCount > 0

  Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    // Stage 2.6: Thinking / Refresh / Abort / offline orange banner row removed.
    // Stage 2.7: busy send → stop square → chat.abort (Web handleAbortChat).
    // Stage 3.3: Web attach progress capsules + mic → Voice/TalkMode path.

    if (attachments.isNotEmpty()) {
      AttachmentsStrip(attachments = attachments, onRemoveAttachment = onRemoveAttachment)
    }

    // Pill composer SoT: 📎 | 「继续输入消息...」 | 🎤 | red circular send / stop square.
    Surface(
      modifier = Modifier.fillMaxWidth(),
      shape = RoundedCornerShape(999.dp),
      color = Color.White,
      border = BorderStroke(1.dp, mobileBorder),
      shadowElevation = 4.dp,
      tonalElevation = 0.dp,
    ) {
      Row(
        modifier =
          Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
      ) {
        IconButton(
          onClick = onPickAttachments,
          enabled = !sendBusy && !attachmentsBusy,
          modifier = Modifier.size(40.dp),
        ) {
          Icon(
            Icons.Default.AttachFile,
            contentDescription = "添加附件",
            tint = if (!sendBusy && !attachmentsBusy) mobileTextSecondary else mobileTextTertiary,
            modifier = Modifier.size(20.dp),
          )
        }

        Box(modifier = Modifier.weight(1f).padding(vertical = 8.dp)) {
          if (input.isEmpty()) {
            Text(
              text = "继续输入消息...",
              style = mobileBodyStyle(),
              color = mobileTextTertiary,
            )
          }
          BasicTextField(
            value = input,
            onValueChange = { input = it },
            modifier = Modifier.fillMaxWidth(),
            textStyle = mobileBodyStyle().copy(color = mobileText),
            cursorBrush = SolidColor(mobileAccent),
            singleLine = false,
            maxLines = 4,
            enabled = !sendBusy,
          )
        }

        IconButton(
          onClick = { onMicClick?.invoke() },
          enabled = onMicClick != null && !sendBusy,
          modifier = Modifier.size(40.dp),
        ) {
          Icon(
            Icons.Default.Mic,
            contentDescription = "语音输入",
            tint = if (onMicClick != null && !sendBusy) mobileTextSecondary else mobileTextTertiary,
            modifier = Modifier.size(20.dp),
          )
        }

        Surface(
          onClick = {
            if (sendBusy) {
              onAbort()
              return@Surface
            }
            if (!canSend) return@Surface
            val text = input
            input = ""
            onSend(text)
          },
          enabled = canSend || sendBusy,
          shape = CircleShape,
          color =
            when {
              sendBusy -> sendRed
              canSend -> sendRed
              else -> sendRedDisabled
            },
          modifier = Modifier.size(32.dp), // SoT .send 32px
        ) {
          Box(contentAlignment = Alignment.Center) {
            if (sendBusy) {
              // SoT: red circular control becomes stop square while running.
              Box(
                modifier =
                  Modifier
                    .size(14.dp)
                    .background(Color.White, RoundedCornerShape(2.dp)),
              )
            } else {
              Icon(
                Icons.AutoMirrored.Filled.Send,
                contentDescription = "发送",
                tint = Color.White,
                modifier = Modifier.size(18.dp),
              )
            }
          }
        }
      }
    }
  }
}

@Composable
private fun AttachmentsStrip(
  attachments: List<PendingChatAttachment>,
  onRemoveAttachment: (id: String) -> Unit,
) {
  Row(
    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    for (att in attachments) {
      AttachmentChip(
        attachment = att,
        onRemove = { onRemoveAttachment(att.id) },
      )
    }
  }
}

@Composable
private fun AttachmentChip(
  attachment: PendingChatAttachment,
  onRemove: () -> Unit,
) {
  val failed = attachment.status == PendingAttachmentStatus.Failed
  val reading = attachment.status == PendingAttachmentStatus.Reading
  Surface(
    shape = RoundedCornerShape(999.dp),
    color = if (failed) Color(0xFFFFF1F0) else mobileAccentSoft,
    border = BorderStroke(1.dp, if (failed) Color(0xFFF5C2C0) else mobileBorderStrong),
  ) {
    Row(
      modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      if (reading) {
        CircularProgressIndicator(
          modifier = Modifier.size(14.dp),
          strokeWidth = 2.dp,
          color = mobileAccent,
        )
      }
      Column {
        Text(
          text = attachment.fileName,
          style = mobileCaption1,
          color = mobileText,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        Text(
          text = formatAttachmentStatusLabel(attachment),
          style = mobileCaption1.copy(fontSize = 11.sp),
          color = if (failed) Color(0xFFCF1322) else mobileTextSecondary,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
      Surface(
        onClick = onRemove,
        shape = RoundedCornerShape(999.dp),
        color = Color.White,
        border = BorderStroke(1.dp, mobileBorderStrong),
      ) {
        Text(
          text = "×",
          style = mobileCaption1.copy(fontWeight = FontWeight.Bold),
          color = mobileTextSecondary,
          modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
        )
      }
    }
  }
}

@Composable
private fun mobileBodyStyle() =
  MaterialTheme.typography.bodyMedium.copy(
    fontFamily = ai.openbot.app.ui.mobileFontFamily,
    fontWeight = FontWeight.Medium,
    fontSize = 15.sp,
    lineHeight = 22.sp,
  )
