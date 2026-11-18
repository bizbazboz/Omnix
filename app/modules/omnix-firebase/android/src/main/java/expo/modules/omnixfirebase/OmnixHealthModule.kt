package expo.modules.omnixfirebase

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.graphics.Color
import android.widget.TextView
import android.widget.ScrollView
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.*
import java.time.*

class OmnixHealthModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private var permissionPromise: Promise? = null
  private val types = mapOf("steps" to StepsRecord::class, "distance" to DistanceRecord::class,
    "workout_minutes" to ExerciseSessionRecord::class, "sleep" to SleepSessionRecord::class)
  private fun context() = requireNotNull(appContext.reactContext) { "Companion context unavailable" }
  private fun client() = HealthConnectClient.getOrCreate(context())
  private fun keys(input: List<String>) = input.distinct().also { require(it.size <= 4 && it.all(types::containsKey)) }
  private suspend fun granted(): List<String> {
    val permissions = client().permissionController.getGrantedPermissions()
    return types.filter { (_, type) -> HealthPermission.getReadPermission(type) in permissions }.keys.toList()
  }
  private fun launch(promise: Promise, action: suspend () -> Any?) {
    scope.launch {
      try { promise.resolve(action()) }
      catch (_: SecurityException) { promise.reject("E_HEALTH_PERMISSION", "Health permission changed. Review permissions and sync again.", null) }
      catch (_: Exception) { promise.reject("E_HEALTH", "Could not read Health Connect. Check availability, permissions and return to Omnix.", null) }
    }
  }
  override fun definition() = ModuleDefinition {
    Name("OmnixHealth")
    AsyncFunction("status") { promise: Promise -> launch(promise) {
      val status = HealthConnectClient.getSdkStatus(context())
      mapOf("available" to (status == HealthConnectClient.SDK_AVAILABLE), "status" to status, "timezone" to ZoneId.systemDefault().id,
        "permissions" to if (status == HealthConnectClient.SDK_AVAILABLE) granted() else emptyList<String>())
    } }
    AsyncFunction("permissions") { selected: List<String>, promise: Promise ->
      try {
        require(permissionPromise == null) { "Permission request already open" }
        val requested = keys(selected).map { HealthPermission.getReadPermission(types.getValue(it)) }.toSet()
        require(requested.isNotEmpty())
        val activity = requireNotNull(appContext.currentActivity)
        permissionPromise = promise
        activity.runOnUiThread {
          try {
            val intent = PermissionController.createRequestPermissionResultContract().createIntent(activity, requested)
            if (intent.action == RequestMultiplePermissions.ACTION_REQUEST_PERMISSIONS) {
              // Android 14+ uses a runtime-permission contract, not a launchable Activity.
              // Expo's manager also routes the result through ReactActivity's permission listener.
              requireNotNull(appContext.permissions).askForPermissions({ _ ->
                permissionPromise = null
                launch(promise) { granted() }
              }, *requested.toTypedArray())
            } else activity.startActivityForResult(intent, 58153)
          }
          catch (_: Exception) { permissionPromise = null; promise.reject("E_HEALTH_PERMISSION", "Could not open Health Connect permissions.", null) }
        }
      } catch (_: Exception) { promise.reject("E_HEALTH_PERMISSION", "A Health Connect permission request is already open or unavailable.", null) }
    }
    OnActivityResult { _, result ->
      if (result.requestCode == 58153) {
        val promise = permissionPromise
        permissionPromise = null
        if (promise != null) launch(promise) { granted() }
      }
    }
    AsyncFunction("settings") { promise: Promise ->
      try {
        val activity = requireNotNull(appContext.currentActivity)
        activity.startActivity(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS))
        promise.resolve(null)
      } catch (_: Exception) { promise.reject("E_HEALTH_SETTINGS", "Install or update Health Connect in Android settings.", null) }
    }
    AsyncFunction("read") { selected: List<String>, timezone: String, token: String, force: Boolean, promise: Promise -> launch(promise) {
      val selectedKeys = keys(selected)
      val permissions = granted().filter { it in selectedKeys }
      val zone = ZoneId.of(timezone)
      val today = LocalDate.now(zone)
      val dates = (27 downTo 0).map { today.minusDays(it.toLong()).toString() }
      if (permissions.isEmpty()) return@launch mapOf("permissions" to permissions, "points" to emptyMap<String, Any>(),
        "dates" to dates, "timezone" to timezone, "captured_at" to Instant.now().toString(), "changes_token" to "", "unchanged" to false)
      var changed = token.isEmpty()
      var cursor = token
      if (token.isNotEmpty()) {
        try {
          var pages = 0
          do {
            val response = client().getChanges(cursor)
            if (response.changesTokenExpired) { changed = true; cursor = ""; break }
            changed = changed || response.changes.isNotEmpty()
            cursor = response.nextChangesToken
            require(++pages <= 100) { "Change history needs a fresh snapshot" }
          } while (response.hasMore)
        } catch (_: Exception) { changed = true; cursor = "" }
      }
      if (!changed && !force) return@launch mapOf("permissions" to permissions, "unchanged" to true)
      // Capture before reading so edits during aggregation are seen on the next sync.
      if (cursor.isEmpty()) cursor = client().getChangesToken(ChangesTokenRequest(recordTypes = permissions.map { types.getValue(it) }.toSet()))
      val metrics = mutableSetOf<AggregateMetric<*>>()
      if ("steps" in permissions) metrics.add(StepsRecord.COUNT_TOTAL)
      if ("distance" in permissions) metrics.add(DistanceRecord.DISTANCE_TOTAL)
      if ("workout_minutes" in permissions) metrics.add(ExerciseSessionRecord.EXERCISE_DURATION_TOTAL)
      if ("sleep" in permissions) metrics.add(SleepSessionRecord.SLEEP_DURATION_TOTAL)
      val points = permissions.associateWith { mutableMapOf<String, Double>() }
      val buckets = client().aggregateGroupByPeriod(AggregateGroupByPeriodRequest(metrics = metrics,
        timeRangeFilter = TimeRangeFilter.between(today.minusDays(27).atStartOfDay(), today.plusDays(1).atStartOfDay()), timeRangeSlicer = Period.ofDays(1)))
      for (bucket in buckets) {
        val day = bucket.startTime.toLocalDate().toString()
        if ("steps" in permissions) bucket.result[StepsRecord.COUNT_TOTAL]?.let { points.getValue("steps")[day] = it.toDouble() }
        if ("distance" in permissions) bucket.result[DistanceRecord.DISTANCE_TOTAL]?.let { points.getValue("distance")[day] = it.inKilometers }
        if ("workout_minutes" in permissions) bucket.result[ExerciseSessionRecord.EXERCISE_DURATION_TOTAL]?.let { points.getValue("workout_minutes")[day] = it.toMillis() / 60000.0 }
        if ("sleep" in permissions) bucket.result[SleepSessionRecord.SLEEP_DURATION_TOTAL]?.let { points.getValue("sleep")[day] = it.toMillis() / 3600000.0 }
      }
      mapOf("permissions" to permissions, "points" to points, "dates" to dates, "timezone" to timezone,
        "captured_at" to Instant.now().toString(), "changes_token" to cursor, "unchanged" to false)
    } }
    OnDestroy { scope.cancel(); permissionPromise?.reject("E_HEALTH_CANCELLED", "Health request cancelled.", null); permissionPromise = null }
  }
}

/** Public permission rationale only. No private records or URLs are accepted. */
class HealthPrivacyActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.statusBarColor = Color.BLACK
    val text = TextView(this).apply {
      setBackgroundColor(Color.BLACK); setTextColor(Color.WHITE); textSize = 18f
      setPadding(32, 48, 32, 48)
      text = "OMNIX / HEALTH CONNECT\n\nYour health, your choice.\n\nOmnix reads only the categories you select: steps, distance, exercise duration and sleep. It never writes to Health Connect and does not read routes, location or medical records.\n\nDaily totals for the last 28 days are sent to your paired Omnix server over its authenticated HTTPS session. Saved readings are private to your account and encrypted on that server. They appear on Health and your homepage.\n\nSync runs while Omnix is open. No background health permission is requested. Revoking permission stops future reads; previously synced history remains until you choose Forget phone data in Settings, Integrations, Health Connect. Previously archived history stays separate.\n\nManage permissions in Android Health Connect settings."
    }
    setContentView(ScrollView(this).apply { setBackgroundColor(Color.BLACK); addView(text) })
  }
}
