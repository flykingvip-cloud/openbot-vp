package ai.openbot.app.ui.chat

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.openbot.app.chat.DeliverableEnvelope
import ai.openbot.app.chat.deliverableOpenEnabled
import ai.openbot.app.ui.mobileBorder
import ai.openbot.app.ui.mobileCaption1
import ai.openbot.app.ui.mobileSurfaceStrong
import ai.openbot.app.ui.mobileText
import ai.openbot.app.ui.mobileTextSecondary
import ai.openbot.app.ui.mobileTextTertiary

/**
 * Single deliverable footer (IMG_1711): left title/targetLabel, right 「打开成果」.
 * No multi-chip / deposit / badges.
 */
@Composable
fun ChatDeliverableFooter(
  envelope: DeliverableEnvelope,
  modifier: Modifier = Modifier,
) {
  val context = LocalContext.current
  val label = envelope.targetLabel().ifBlank { "成果" }
  val openEnabled = deliverableOpenEnabled(envelope)

  Column(modifier = modifier.fillMaxWidth()) {
    HorizontalDivider(
      modifier = Modifier.padding(top = 8.dp, bottom = 8.dp),
      thickness = 1.dp,
      color = mobileBorder,
    )
    Row(
      modifier = Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.SpaceBetween,
    ) {
      Text(
        text = label,
        style = mobileCaption1,
        color = mobileTextSecondary,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.weight(1f, fill = false).padding(end = 8.dp),
      )
      Column(horizontalAlignment = Alignment.End) {
        Surface(
          onClick = {
            if (openEnabled) {
              openDeliverableUrl(context, envelope.url!!)
            }
          },
          enabled = openEnabled,
          shape = RoundedCornerShape(999.dp),
          color = if (openEnabled) mobileSurfaceStrong else mobileSurfaceStrong.copy(alpha = 0.55f),
          border = BorderStroke(1.dp, mobileBorder),
          modifier = Modifier,
        ) {
          Text(
            text = "打开成果",
            style = mobileCaption1.copy(fontWeight = FontWeight.SemiBold),
            color = if (openEnabled) mobileText else mobileTextTertiary,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
          )
        }
        if (!openEnabled) {
          Text(
            text = "本地文件暂不可用",
            style = mobileCaption1,
            color = mobileTextTertiary,
            modifier = Modifier.padding(top = 4.dp),
          )
        }
      }
    }
  }
}

/**
 * Open MVP: http/https → Custom Tabs; other schemes → ACTION_VIEW.
 * File-only paths are never opened here (button disabled upstream).
 */
fun openDeliverableUrl(context: Context, url: String) {
  val uri = Uri.parse(url)
  val scheme = uri.scheme?.lowercase().orEmpty()
  try {
    if (scheme == "http" || scheme == "https") {
      CustomTabsIntent.Builder().build().launchUrl(context, uri)
    } else {
      val intent = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  } catch (_: ActivityNotFoundException) {
    // Best-effort fallback
    try {
      val intent = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    } catch (_: Throwable) {
      // swallow — UI already gated; no toast dependency in MVP
    }
  } catch (_: Throwable) {
    // ignore
  }
}
