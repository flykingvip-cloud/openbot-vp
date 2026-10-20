package ai.openbot.app.employeeshell

import ai.openbot.app.MainActivity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

//
// Local/system notification click-through -> deep link (task 1.7-android).
//
// Kotlin counterpart to apps/macos/.../EmployeeNotificationRouter.swift. A tapped
// notification carries an `openbot://` (primary) or `openclaw://` (compatibility)
// link in an intent extra; the tap opens MainActivity, which forwards it through the SAME
// auth-gated, account-scoped deep-link path as external links (deferred to login
// when signed out). Wave 1 is LOCAL notifications only; employee server push is
// Wave 2.
//
object EmployeeNotificationRouter {
  /** Intent extra carrying the deep-link string on a tapped notification. */
  const val DEEP_LINK_EXTRA = "ai.openclaw.employee.deepLink"

  const val CHANNEL_ID = "employee_shell"
  private const val CHANNEL_NAME = "Workspace"

  /** Pure: extract a usable deep link from an intent extra value, or null. */
  fun deepLinkFromExtra(extra: String?): String? = extra?.trim()?.takeIf { it.isNotEmpty() }

  fun ensureChannel(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT),
      )
    }
  }

  /**
   * Post a local notification whose tap opens the app and routes [deepLink]
   * through the auth-gated deep-link path.
   */
  fun notify(
    context: Context,
    notificationId: Int,
    title: String,
    body: String,
    deepLink: String,
    smallIconRes: Int,
  ) {
    ensureChannel(context)
    val intent =
      Intent(context, MainActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
        putExtra(DEEP_LINK_EXTRA, deepLink)
      }
    val pending =
      PendingIntent.getActivity(
        context,
        notificationId,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    val notification =
      NotificationCompat.Builder(context, CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(body)
        .setSmallIcon(smallIconRes)
        .setContentIntent(pending)
        .setAutoCancel(true)
        .build()
    context.getSystemService(NotificationManager::class.java)?.notify(notificationId, notification)
  }
}
