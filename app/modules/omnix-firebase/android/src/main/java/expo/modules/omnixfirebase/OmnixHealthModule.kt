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
import androidx.health.connect.client.request.ReadRecordsRequest
import kotlin.reflect.KClass
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
  private val types = mapOf(
    "steps" to StepsRecord::class,
    "distance" to DistanceRecord::class,
    "weight" to WeightRecord::class,
    "calories" to TotalCaloriesBurnedRecord::class,
    "workout_minutes" to ExerciseSessionRecord::class,
    "sleep" to SleepSessionRecord::class,
    "active_energy" to ActiveCaloriesBurnedRecord::class,
    "heart_rate" to HeartRateRecord::class,
    "oxygen" to OxygenSaturationRecord::class,
    "systolic" to BloodPressureRecord::class,
    "diastolic" to BloodPressureRecord::class,
    "glucose" to BloodGlucoseRecord::class,
    "body_fat" to BodyFatRecord::class,
    "bmr" to BasalMetabolicRateRecord::class,
    "height" to HeightRecord::class,
    "vo2_max" to Vo2MaxRecord::class,
    "power" to PowerRecord::class,
    "speed" to SpeedRecord::class,
    "calories_in" to NutritionRecord::class,
    "protein" to NutritionRecord::class,
    "carbs" to NutritionRecord::class,
    "fat" to NutritionRecord::class,
    "fibre" to NutritionRecord::class,
    "sugar" to NutritionRecord::class,
    "sodium" to NutritionRecord::class)
  private fun context() = requireNotNull(appContext.reactContext) { "Companion context unavailable" }
  private fun client() = HealthConnectClient.getOrCreate(context())
  private fun keys(input: List<String>) = input.distinct().also { require(it.size <= types.size && it.all(types::containsKey)) }
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
  // Instant measurements use the latest observation in each phone-local day.
  private suspend fun <T : Record> latest(type: KClass<T>, today: LocalDate, zone: ZoneId, reading: (T) -> Pair<Instant, Double>): Map<String, Double> {
    val values = mutableMapOf<String, Triple<Instant, Instant, Double>>()
    var page: String? = null
    var pages = 0
    do {
      val response = client().readRecords(ReadRecordsRequest(recordType = type,
        timeRangeFilter = TimeRangeFilter.between(today.minusDays(27).atStartOfDay(zone).toInstant(), today.plusDays(1).atStartOfDay(zone).toInstant()),
        pageSize = 1000, pageToken = page))
      for (record in response.records) {
        val point = reading(record)
        val day = point.first.atZone(zone).toLocalDate().toString()
        val candidate = Triple(point.first, record.metadata.lastModifiedTime, point.second)
        val previous = values[day]
        if (previous == null || previous.first < candidate.first ||
          previous.first == candidate.first && previous.second < candidate.second) values[day] = candidate
      }
      page = response.pageToken
      require(++pages <= 100) { "Too much measurement history" }
    } while (page != null)
    return values.mapValues { it.value.third }
  }
  override fun definition() = ModuleDefinition {
    Name("OmnixHealth")
    AsyncFunction("status") { promise: Promise -> launch(promise) {
      val status = HealthConnectClient.getSdkStatus(context())
      mapOf("available" to (status == HealthConnectClient.SDK_AVAILABLE), "status" to status, "timezone" to ZoneId.systemDefault().id,
        "supported_metrics" to types.keys.toList(), "permissions" to if (status == HealthConnectClient.SDK_AVAILABLE) granted() else emptyList<String>())
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
      if ("calories" in permissions) metrics.add(TotalCaloriesBurnedRecord.ENERGY_TOTAL)
      if ("workout_minutes" in permissions) metrics.add(ExerciseSessionRecord.EXERCISE_DURATION_TOTAL)
      if ("sleep" in permissions) metrics.add(SleepSessionRecord.SLEEP_DURATION_TOTAL)
      if ("active_energy" in permissions) metrics.add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
      if ("heart_rate" in permissions) metrics.add(HeartRateRecord.BPM_AVG)
      if ("power" in permissions) metrics.add(PowerRecord.POWER_AVG)
      if ("speed" in permissions) metrics.add(SpeedRecord.SPEED_AVG)
      if ("calories_in" in permissions) metrics.add(NutritionRecord.ENERGY_TOTAL)
      if ("protein" in permissions) metrics.add(NutritionRecord.PROTEIN_TOTAL)
      if ("carbs" in permissions) metrics.add(NutritionRecord.TOTAL_CARBOHYDRATE_TOTAL)
      if ("fat" in permissions) metrics.add(NutritionRecord.TOTAL_FAT_TOTAL)
      if ("fibre" in permissions) metrics.add(NutritionRecord.DIETARY_FIBER_TOTAL)
      if ("sugar" in permissions) metrics.add(NutritionRecord.SUGAR_TOTAL)
      if ("sodium" in permissions) metrics.add(NutritionRecord.SODIUM_TOTAL)
      val points = permissions.associateWith { mutableMapOf<String, Double>() }
      val buckets = if (metrics.isNotEmpty()) client().aggregateGroupByPeriod(AggregateGroupByPeriodRequest(metrics = metrics,
        timeRangeFilter = TimeRangeFilter.between(today.minusDays(27).atStartOfDay(), today.plusDays(1).atStartOfDay()), timeRangeSlicer = Period.ofDays(1))) else emptyList()
      for (bucket in buckets) {
        val day = bucket.startTime.toLocalDate().toString()
        if ("steps" in permissions) bucket.result[StepsRecord.COUNT_TOTAL]?.let { points.getValue("steps")[day] = it.toDouble() }
        if ("distance" in permissions) bucket.result[DistanceRecord.DISTANCE_TOTAL]?.let { points.getValue("distance")[day] = it.inKilometers }
        if ("calories" in permissions) bucket.result[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.let { points.getValue("calories")[day] = it.inKilocalories }
        if ("workout_minutes" in permissions) bucket.result[ExerciseSessionRecord.EXERCISE_DURATION_TOTAL]?.let { points.getValue("workout_minutes")[day] = it.toMillis() / 60000.0 }
        if ("sleep" in permissions) bucket.result[SleepSessionRecord.SLEEP_DURATION_TOTAL]?.let { points.getValue("sleep")[day] = it.toMillis() / 3600000.0 }
        if ("active_energy" in permissions) bucket.result[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.let { points.getValue("active_energy")[day] = it.inKilocalories }
        if ("heart_rate" in permissions) bucket.result[HeartRateRecord.BPM_AVG]?.let { points.getValue("heart_rate")[day] = it.toDouble() }
        if ("power" in permissions) bucket.result[PowerRecord.POWER_AVG]?.let { points.getValue("power")[day] = it.inWatts }
        if ("speed" in permissions) bucket.result[SpeedRecord.SPEED_AVG]?.let { points.getValue("speed")[day] = it.inKilometersPerHour }
        if ("calories_in" in permissions) bucket.result[NutritionRecord.ENERGY_TOTAL]?.let { points.getValue("calories_in")[day] = it.inKilocalories }
        if ("protein" in permissions) bucket.result[NutritionRecord.PROTEIN_TOTAL]?.let { points.getValue("protein")[day] = it.inGrams }
        if ("carbs" in permissions) bucket.result[NutritionRecord.TOTAL_CARBOHYDRATE_TOTAL]?.let { points.getValue("carbs")[day] = it.inGrams }
        if ("fat" in permissions) bucket.result[NutritionRecord.TOTAL_FAT_TOTAL]?.let { points.getValue("fat")[day] = it.inGrams }
        if ("fibre" in permissions) bucket.result[NutritionRecord.DIETARY_FIBER_TOTAL]?.let { points.getValue("fibre")[day] = it.inGrams }
        if ("sugar" in permissions) bucket.result[NutritionRecord.SUGAR_TOTAL]?.let { points.getValue("sugar")[day] = it.inGrams }
        if ("sodium" in permissions) bucket.result[NutritionRecord.SODIUM_TOTAL]?.let { points.getValue("sodium")[day] = it.inMilligrams }
      }
      if ("weight" in permissions) points.getValue("weight").putAll(latest(WeightRecord::class, today, zone) { it.time to it.weight.inKilograms })
      if ("oxygen" in permissions) points.getValue("oxygen").putAll(latest(OxygenSaturationRecord::class, today, zone) { it.time to it.percentage.value })
      if ("systolic" in permissions) points.getValue("systolic").putAll(latest(BloodPressureRecord::class, today, zone) { it.time to it.systolic.inMillimetersOfMercury })
      if ("diastolic" in permissions) points.getValue("diastolic").putAll(latest(BloodPressureRecord::class, today, zone) { it.time to it.diastolic.inMillimetersOfMercury })
      if ("glucose" in permissions) points.getValue("glucose").putAll(latest(BloodGlucoseRecord::class, today, zone) { it.time to it.level.inMilligramsPerDeciliter })
      if ("body_fat" in permissions) points.getValue("body_fat").putAll(latest(BodyFatRecord::class, today, zone) { it.time to it.percentage.value })
      if ("bmr" in permissions) points.getValue("bmr").putAll(latest(BasalMetabolicRateRecord::class, today, zone) { it.time to it.basalMetabolicRate.inKilocaloriesPerDay })
      if ("height" in permissions) points.getValue("height").putAll(latest(HeightRecord::class, today, zone) { it.time to it.height.inMeters * 100.0 })
      if ("vo2_max" in permissions) points.getValue("vo2_max").putAll(latest(Vo2MaxRecord::class, today, zone) { it.time to it.vo2MillilitersPerMinuteKilogram })
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
      text = "OMNIX / HEALTH CONNECT\n\nYour health, your choice.\n\nOmnix reads only the categories you select: steps, distance, weight, calories, exercise duration and optional sleep, heart, body and nutrition measurements. It never writes to Health Connect or requests route, location or background-health access.\n\nDaily totals for the last 28 days are sent to your paired Omnix server over its authenticated HTTPS session. Saved readings are private to your account and encrypted on that server. They appear on Health and your homepage.\n\nSync runs while Omnix is open. No background health permission is requested. Revoking permission stops future reads; previously synced history remains until you choose Forget phone data in Settings, Integrations, Health Connect. Previously archived history stays separate.\n\nManage permissions in Android Health Connect settings."
    }
    setContentView(ScrollView(this).apply { setBackgroundColor(Color.BLACK); addView(text) })
  }
}
