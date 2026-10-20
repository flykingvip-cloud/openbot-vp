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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Article
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Podcasts
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.openbot.app.ui.mobileAccent
import ai.openbot.app.ui.mobileBorder
import ai.openbot.app.ui.mobileCaption1
import ai.openbot.app.ui.mobileDanger
import ai.openbot.app.ui.mobileHeadline
import ai.openbot.app.ui.mobileText
import ai.openbot.app.ui.mobileTextSecondary
import ai.openbot.app.ui.mobileTextTertiary

/** HTML SoT `.agent-chip` — icon tile + name under; active = blue icon border. */
private val stripIconBg = Color(0xFFF3F4F6)
private val stripIconBgBot = Color(0xFFEEF2FF)
private val stripIconBgHome = Color(0xFFDBEAFE)
private val stripIconBgGroup = Color(0xFFECFDF5)
private val stripIconIdle = Color(0xFF64748B)

@Composable
fun ChatAgentStrip(
  model: AgentStripNavModel,
  onSelect: (selectionKey: String) -> Unit,
  modifier: Modifier = Modifier,
) {
  Row(
    modifier =
      modifier
        .fillMaxWidth()
        .background(Color.White)
        .padding(horizontal = 12.dp, vertical = 0.dp)
        .padding(top = 10.dp, bottom = 8.dp)
        .horizontalScroll(rememberScrollState()),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
    verticalAlignment = Alignment.Top,
  ) {
    for (item in model.stripItems) {
      AgentStripChip(item = item, onClick = { onSelect(item.selectionKey) })
    }
  }
}

@Composable
private fun AgentStripChip(
  item: AgentStripItem,
  onClick: () -> Unit,
) {
  val iconBg =
    when (item.module) {
      AgentStripModule.Collaboration -> stripIconBgGroup
      AgentStripModule.Assistant ->
        if (item.iconKey == AgentStripIconKey.Brain) stripIconBgHome else stripIconBgBot
    }
  // HTML SoT preview-aligned (optional visual): collab chips rounder than bots (16 vs 14).
  val iconShape =
    when (item.module) {
      AgentStripModule.Collaboration -> RoundedCornerShape(16.dp)
      AgentStripModule.Assistant -> RoundedCornerShape(14.dp)
    }
  val isSteward = item.id == BUILTIN_STEWARD_NAV_ID
  Column(
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(5.dp),
    modifier = Modifier.widthIn(min = 56.dp, max = 64.dp),
  ) {
    Box(contentAlignment = Alignment.TopEnd) {
      Surface(
        onClick = onClick,
        shape = iconShape,
        color = iconBg,
        border =
          BorderStroke(
            width = if (item.active) 2.dp else 0.dp,
            color = if (item.active) mobileAccent else Color.Transparent,
          ),
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
        modifier = Modifier.size(44.dp),
      ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxWidth()) {
          Icon(
            imageVector = stripIcon(item.iconKey),
            contentDescription = item.title,
            tint = if (item.active) mobileAccent else stripIconIdle,
            modifier = Modifier.size(22.dp),
          )
        }
      }
      // Preview-aligned optional: 📌 on fixed steward (HTML .has-pin). Count badge still Web ≤9.
      if (isSteward) {
        Surface(
          shape = CircleShape,
          color = Color.White,
          border = BorderStroke(1.dp, mobileBorder),
          modifier = Modifier.padding(top = 0.dp, end = 0.dp),
        ) {
          Text(
            text = "📌",
            style = mobileCaption1.copy(fontSize = 8.sp, lineHeight = 10.sp),
            modifier = Modifier.padding(horizontal = 2.dp, vertical = 1.dp),
          )
        }
      } else {
        // Web workbench-chrome: Math.min(count, 9) — never 99+.
        val badgeLabel = formatAgentStripBadge(item.count)
        if (badgeLabel != null) {
          Surface(
            shape = CircleShape,
            color = mobileDanger,
            border = BorderStroke(2.dp, Color.White),
            modifier = Modifier.padding(top = 0.dp, end = 0.dp),
          ) {
            Text(
              text = badgeLabel,
              color = Color.White,
              style = mobileCaption1.copy(fontWeight = FontWeight.Bold, fontSize = 9.sp, lineHeight = 11.sp),
              modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
            )
          }
        }
      }
    }
    Text(
      text = item.title,
      style =
        mobileCaption1.copy(
          fontWeight = FontWeight.Medium,
          fontSize = 11.sp,
          lineHeight = 13.sp,
        ),
      color = if (item.active) mobileAccent else mobileText,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      textAlign = TextAlign.Center,
      modifier = Modifier.fillMaxWidth(),
    )
  }
}

@Composable
fun ChatToHeader(
  label: String,
  onOpenDoc: (() -> Unit)? = null,
  modifier: Modifier = Modifier,
) {
  // Retained for Web stage header callers; four-tab HTML SoT omits this row.
  if (label.isBlank()) return
  Row(
    modifier = modifier.fillMaxWidth().padding(vertical = 2.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.SpaceBetween,
  ) {
    Text(
      text = label,
      style = mobileHeadline.copy(fontWeight = FontWeight.Bold, fontSize = 18.sp, lineHeight = 24.sp),
      color = mobileText,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      modifier = Modifier.weight(1f),
    )
    Surface(
      onClick = { onOpenDoc?.invoke() },
      enabled = onOpenDoc != null,
      shape = RoundedCornerShape(12.dp),
      color = Color.White,
      border = BorderStroke(1.dp, mobileBorder),
      tonalElevation = 0.dp,
      shadowElevation = 0.dp,
      modifier = Modifier.size(36.dp),
    ) {
      Box(contentAlignment = Alignment.Center) {
        Icon(
          imageVector = Icons.AutoMirrored.Filled.Article,
          contentDescription = "文档",
          tint = if (onOpenDoc != null) mobileTextSecondary else mobileTextTertiary,
          modifier = Modifier.size(18.dp),
        )
      }
    }
  }
}

private fun stripIcon(key: AgentStripIconKey): ImageVector {
  return when (key) {
    AgentStripIconKey.Brain -> Icons.Default.Psychology
    AgentStripIconKey.Sparkles -> Icons.Default.AutoAwesome
    AgentStripIconKey.MessageSquare -> Icons.Default.ChatBubbleOutline
    AgentStripIconKey.Zap -> Icons.Default.Bolt
    AgentStripIconKey.Star -> Icons.Default.Star
    AgentStripIconKey.Radio -> Icons.Default.Podcasts
    AgentStripIconKey.Mic -> Icons.Default.Mic
    AgentStripIconKey.Users -> Icons.Default.Groups
    AgentStripIconKey.MessagesSquare -> Icons.Default.Forum
    AgentStripIconKey.Calendar -> Icons.Default.CalendarMonth
    AgentStripIconKey.ClipboardCheck -> Icons.Default.Checklist
  }
}
