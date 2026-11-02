package ai.openbot.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Shared page header. Subtitle optional — SoT Tasks/Me/Knowledge titles are title-only. */
@Composable
fun MobilePageHeader(
  title: String,
  subtitle: String? = null,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier.fillMaxWidth(),
    verticalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    Text(title, style = mobileTitle1.copy(fontWeight = FontWeight.Bold), color = mobileText)
    if (!subtitle.isNullOrBlank()) {
      Text(subtitle, style = mobileCallout, color = mobileTextSecondary)
    }
  }
}

/**
 * HTML SoT `.seg` control: white track + 1px line, active = --blue fill / white label.
 * Used by Tasks (定时任务|待我处理) and Me (个人设置|设备|更多).
 */
@Composable
fun SoTSegmentedControl(
  options: List<String>,
  selectedIndex: Int,
  onSelect: (Int) -> Unit,
  modifier: Modifier = Modifier,
  compact: Boolean = false,
) {
  Surface(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(10.dp),
    color = Color.White,
    border = BorderStroke(1.dp, mobileBorder),
  ) {
    Row(modifier = Modifier.fillMaxWidth()) {
      options.forEachIndexed { index, label ->
        val selected = index == selectedIndex
        Surface(
          onClick = { onSelect(index) },
          modifier = Modifier.weight(1f),
          shape = RoundedCornerShape(0.dp),
          color = if (selected) mobileAccent else Color.Transparent,
        ) {
          Box(
            modifier =
              Modifier
                .fillMaxWidth()
                .padding(vertical = if (compact) 9.dp else 10.dp, horizontal = 4.dp),
            contentAlignment = Alignment.Center,
          ) {
            Text(
              text = label,
              style =
                (if (compact) mobileCaption1 else mobileCallout).copy(
                  fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                ),
              color = if (selected) Color.White else mobileTextSecondary,
              maxLines = 1,
            )
          }
        }
      }
    }
  }
}

@Composable
fun MobileSoftBanner(
  text: String,
  modifier: Modifier = Modifier,
  tone: MobileBannerTone = MobileBannerTone.Neutral,
) {
  val (bg, fg) =
    when (tone) {
      MobileBannerTone.Neutral -> mobileSurfaceStrong to mobileTextSecondary
      MobileBannerTone.Warning -> mobileWarningSoft to mobileWarning
      MobileBannerTone.Accent -> mobileAccentSoft to mobileAccent
    }
  Surface(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(12.dp),
    color = bg,
  ) {
    Text(
      text = text,
      modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
      style = mobileCaption1,
      color = fg,
    )
  }
}

enum class MobileBannerTone {
  Neutral,
  Warning,
  Accent,
}

/** Flat tappable row — single border layer, trailing chevron. */
@Composable
fun MobileNavRow(
  title: String,
  subtitle: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  icon: ImageVector? = null,
  showDividerBelow: Boolean = false,
) {
  Column(modifier = modifier.fillMaxWidth()) {
    Surface(
      onClick = onClick,
      modifier = Modifier.fillMaxWidth(),
      shape = RoundedCornerShape(14.dp),
      color = Color.White,
      border = BorderStroke(1.dp, mobileBorder),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        if (icon != null) {
          Surface(
            shape = RoundedCornerShape(10.dp),
            color = mobileAccentSoft,
          ) {
            Icon(
              imageVector = icon,
              contentDescription = null,
              tint = mobileAccent,
              modifier = Modifier.padding(8.dp).size(20.dp),
            )
          }
        }
        Column(
          modifier = Modifier.weight(1f),
          verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
          Text(title, style = mobileHeadline, color = mobileText)
          Text(subtitle, style = mobileCallout, color = mobileTextSecondary)
        }
        Icon(
          imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
          contentDescription = null,
          tint = mobileTextTertiary,
        )
      }
    }
    if (showDividerBelow) {
      Spacer(modifier = Modifier.height(8.dp))
    }
  }
}

@Composable
fun MobileSectionLabel(
  text: String,
  modifier: Modifier = Modifier,
) {
  Text(
    text = text,
    modifier = modifier.padding(top = 4.dp, bottom = 2.dp),
    style = mobileCaption1.copy(fontWeight = FontWeight.SemiBold),
    color = mobileTextTertiary,
  )
}

@Composable
fun MobilePrimaryButton(
  label: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  danger: Boolean = false,
) {
  Button(
    onClick = onClick,
    enabled = enabled,
    modifier = modifier.fillMaxWidth().height(50.dp),
    shape = RoundedCornerShape(14.dp),
    colors =
      ButtonDefaults.buttonColors(
        containerColor = if (danger) mobileDanger else mobileAccent,
        contentColor = Color.White,
        disabledContainerColor = (if (danger) mobileDanger else mobileAccent).copy(alpha = 0.35f),
        disabledContentColor = Color.White,
      ),
  ) {
    Text(label, style = mobileHeadline.copy(fontWeight = FontWeight.Bold))
  }
}

@Composable
fun MobileInfoBlock(
  label: String,
  value: String,
  modifier: Modifier = Modifier,
  monospace: Boolean = false,
) {
  Column(
    modifier = modifier.fillMaxWidth(),
    verticalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    Text(label, style = mobileCaption1, color = mobileTextTertiary)
    Text(
      value,
      style = if (monospace) mobileBody.copy(fontFamily = FontFamily.Monospace) else mobileBody,
      color = mobileText,
    )
  }
}

@Composable
fun MobileWhiteCard(
  modifier: Modifier = Modifier,
  content: @Composable ColumnScope.() -> Unit,
) {
  Surface(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(14.dp),
    color = Color.White,
    border = BorderStroke(1.dp, mobileBorder),
  ) {
    Column(
      modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp),
      content = content,
    )
  }
}

@Composable
fun MobileQuietDivider(modifier: Modifier = Modifier) {
  HorizontalDivider(modifier = modifier, color = mobileBorder, thickness = 1.dp)
}


/** One row inside [MobileGroupedNavCard] — HTML SoT `.group > .row`. */
data class MobileGroupedNavItem(
  val title: String,
  val subtitle: String,
  val onClick: () -> Unit,
  val icon: ImageVector? = null,
)

/** HTML SoT single white `.group` card with hairline dividers between rows. */
@Composable
fun MobileGroupedNavCard(
  rows: List<MobileGroupedNavItem>,
  modifier: Modifier = Modifier,
) {
  Surface(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(14.dp),
    color = Color.White,
    border = BorderStroke(1.dp, mobileBorder),
  ) {
    Column(modifier = Modifier.fillMaxWidth()) {
      rows.forEachIndexed { index, row ->
        Surface(
          onClick = row.onClick,
          color = Color.White,
          shape = RoundedCornerShape(0.dp),
        ) {
          Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            if (row.icon != null) {
              Surface(
                shape = RoundedCornerShape(10.dp),
                color = mobileAccentSoft,
              ) {
                Icon(
                  imageVector = row.icon,
                  contentDescription = null,
                  tint = mobileAccent,
                  modifier = Modifier.padding(8.dp).size(20.dp),
                )
              }
            }
            Column(
              modifier = Modifier.weight(1f),
              verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
              Text(row.title, style = mobileHeadline, color = mobileText)
              Text(row.subtitle, style = mobileCallout, color = mobileTextSecondary)
            }
            Icon(
              imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
              contentDescription = null,
              tint = mobileTextTertiary,
            )
          }
        }
        if (index < rows.lastIndex) {
          HorizontalDivider(color = mobileBorder, thickness = 1.dp, modifier = Modifier.padding(start = 56.dp))
        }
      }
    }
  }
}
