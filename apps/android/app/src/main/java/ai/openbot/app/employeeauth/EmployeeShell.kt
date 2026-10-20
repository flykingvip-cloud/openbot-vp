package ai.openbot.app.employeeauth

import android.content.Context

//
// App-level accessor for the shared EmployeeShellController (task 1.7-android).
//
// A single controller instance backs both the Employee Shell UI (EmployeeShellHost)
// and the deep-link / notification entry points (MainActivity, notifications), so
// a deep link routed from a cold or warm launch reaches the same session state.
//
object EmployeeShell {
  @Volatile private var instance: EmployeeShellController? = null

  fun controller(context: Context): EmployeeShellController =
    instance ?: synchronized(this) {
      instance ?: EmployeeShellController(context.applicationContext).also { instance = it }
    }
}
