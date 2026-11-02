package ai.openbot.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ColdStartRootTest {
  @Test
  fun loggedOutColdStartIsEmployeeShellLogin() {
    val plan = ColdStartRoot.resolve(loggedIn = false, explicitCompanion = false)
    assertEquals(ColdStartRoot.Destination.EmployeeShell, plan.destination)
    assertEquals(false, plan.companionCoversShell)
  }

  @Test
  fun loggedInColdStartIsFourTabCompanion() {
    val plan = ColdStartRoot.resolve(loggedIn = true, explicitCompanion = false)
    assertEquals(ColdStartRoot.Destination.Companion, plan.destination)
    assertEquals(false, plan.companionCoversShell)
  }

  @Test
  fun loggedInColdStartIgnoresExplicitCompanionExtra() {
    val plan = ColdStartRoot.resolve(loggedIn = true, explicitCompanion = true)
    assertEquals(ColdStartRoot.Destination.Companion, plan.destination)
    assertEquals(false, plan.companionCoversShell)
  }

  @Test
  fun explicitCompanionWithoutSessionCoversShell() {
    val plan = ColdStartRoot.resolve(loggedIn = false, explicitCompanion = true)
    assertEquals(ColdStartRoot.Destination.Companion, plan.destination)
    assertEquals(true, plan.companionCoversShell)
  }

  @Test
  fun afterLoginShowsCompanionAsHome() {
    val plan = ColdStartRoot.afterLogin()
    assertEquals(ColdStartRoot.Destination.Companion, plan.destination)
    assertEquals(false, plan.companionCoversShell)
  }

  @Test
  fun meOpensLoggedInWorkbenchOnly() {
    assertEquals(
      ColdStartRoot.Destination.EmployeeShell,
      ColdStartRoot.workbenchFromMe(loggedIn = true),
    )
    assertNull(ColdStartRoot.workbenchFromMe(loggedIn = false))
  }

  @Test
  fun restoreWithoutSnapshotMatchesColdStart() {
    val plan =
      ColdStartRoot.restore(
        loggedIn = true,
        hasSavedState = false,
        explicitCompanion = false,
      )
    assertEquals(ColdStartRoot.Destination.Companion, plan.destination)
    assertEquals(false, plan.companionCoversShell)
  }

  @Test
  fun loggedInColdStartIgnoresStaleShellFlag() {
    // No saved snapshot: a default false companion flag must not open the
    // Employee Shell (or its offline placeholder). Home is the four-tab chat.
    val plan =
      ColdStartRoot.restore(
        loggedIn = true,
        hasSavedState = false,
        savedCompanion = false,
        savedCoversShell = false,
        explicitCompanion = false,
      )
    assertEquals(ColdStartRoot.Destination.Companion, plan.destination)
    assertEquals(false, plan.companionCoversShell)
  }

  @Test
  fun restoreCompanionHomeWithoutSessionFallsBackToLogin() {
    val plan =
      ColdStartRoot.restore(
        loggedIn = false,
        hasSavedState = true,
        savedCompanion = true,
        savedCoversShell = false,
      )
    assertEquals(ColdStartRoot.Destination.EmployeeShell, plan.destination)
    assertEquals(false, plan.companionCoversShell)
  }

  @Test
  fun restoreLoggedInWorkbenchStaysOnShell() {
    val plan =
      ColdStartRoot.restore(
        loggedIn = true,
        hasSavedState = true,
        savedCompanion = false,
        savedCoversShell = false,
      )
    assertEquals(ColdStartRoot.Destination.EmployeeShell, plan.destination)
  }
}
