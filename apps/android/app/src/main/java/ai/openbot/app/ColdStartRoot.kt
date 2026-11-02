package ai.openbot.app

/**
 * Which UI a cold start paints (Android Stage 2.2, routing scheme A).
 *
 * The employee home is the four-tab companion: Agent Strip chat, then
 * 任务 / 知识 / 我的. The Employee Shell offline placeholder ("无法连接
 * OpenBot") is a workbench load failure, not this home.
 *
 * - Not logged in → Employee Shell **login card** (Stage 2 / #233). The shell
 *   embed is not the logged-out root.
 * - Already logged in, no saved snapshot → four-tab companion. A default
 *   "not companion" flag must not reopen the shell on a launcher cold start.
 * - Logged-in Employee Shell workbench is opened from 我的, or restored only
 *   when a snapshot says the user was already on that workbench.
 * - [EXTRA_SHOW_COMPANION] still opens the companion over the shell when there
 *   is no employee session (debug / in-shell handoff). A valid session wins:
 *   the companion is home, and back does not uncover the shell.
 */
object ColdStartRoot {
  const val EXTRA_SHOW_COMPANION = "ai.openbot.app.extra.SHOW_COMPANION"
  const val STATE_COMPANION_COVERS_SHELL = "ai.openbot.app.state.COMPANION_COVERS_SHELL"

  enum class Destination {
    /** Employee Shell host: login card when signed out, workbench embed when signed in. */
    EmployeeShell,

    /** [ai.openbot.app.ui.PostOnboardingTabs] four-tab companion. */
    Companion,
  }

  data class Plan(
    val destination: Destination,
    /**
     * True when the companion sits on top of the shell and system back should
     * return to it. False when the companion is the post-login home.
     */
    val companionCoversShell: Boolean,
  )

  fun resolve(loggedIn: Boolean, explicitCompanion: Boolean = false): Plan =
    when {
      loggedIn -> Plan(destination = Destination.Companion, companionCoversShell = false)
      explicitCompanion -> Plan(destination = Destination.Companion, companionCoversShell = true)
      else -> Plan(destination = Destination.EmployeeShell, companionCoversShell = false)
    }

  /** Successful login / valid session: companion becomes home. */
  fun afterLogin(): Plan = Plan(destination = Destination.Companion, companionCoversShell = false)

  /**
   * Me → logged-in Employee Shell workbench. A signed-out session must not
   * open the login card from this CTA.
   */
  fun workbenchFromMe(loggedIn: Boolean): Destination? =
    if (loggedIn) Destination.EmployeeShell else null

  /**
   * Process restore. A companion-home snapshot without a session falls back to
   * the login card. Workbench (companion flag false) is restored as the shell.
   */
  fun restore(
    loggedIn: Boolean,
    hasSavedState: Boolean,
    savedCompanion: Boolean = false,
    savedCoversShell: Boolean = false,
    explicitCompanion: Boolean = false,
  ): Plan {
    if (!hasSavedState) return resolve(loggedIn, explicitCompanion)
    if (!loggedIn && savedCompanion && !savedCoversShell) {
      return Plan(destination = Destination.EmployeeShell, companionCoversShell = false)
    }
    return Plan(
      destination = if (savedCompanion) Destination.Companion else Destination.EmployeeShell,
      companionCoversShell = savedCompanion && savedCoversShell,
    )
  }
}
