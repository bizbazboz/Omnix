package expo.modules.omnixfirebase

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Only public Firebase options are persisted. Server credentials are never accepted here. */
object RuntimeFirebase {
  val executor = Executors.newSingleThreadExecutor()
  private const val PREFS = "omnix-firebase"

  private fun options(context: Context, values: Map<String, String>): FirebaseOptions {
    require(values["packageName"] == context.packageName) { "Firebase configuration does not match this companion package" }
    val sender = values["messagingSenderId"] ?: ""
    require(Regex("[0-9]{6,30}").matches(sender)) { "Invalid Firebase sender" }
    val appId = values["appId"] ?: ""
    require(Regex("1:$sender:android:[a-fA-F0-9]+").matches(appId)) { "Invalid Firebase app ID" }
    val key = values["apiKey"] ?: ""
    require(Regex("AIza[A-Za-z0-9_-]{35}").matches(key)) { "Invalid Firebase public key" }
    val project = values["projectId"] ?: ""
    require(Regex("[a-z][a-z0-9-]{4,28}[a-z0-9]").matches(project)) { "Invalid Firebase project" }
    return FirebaseOptions.Builder().setProjectId(project).setApplicationId(appId)
      .setApiKey(key).setGcmSenderId(sender).build()
  }

  @JvmStatic
  @Synchronized
  fun restore(context: Context) {
    val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("config", null) ?: return
    try {
      val json = JSONObject(saved)
      val values = json.keys().asSequence().associateWith { json.getString(it) }
      val config = options(context, values)
      if (FirebaseApp.getApps(context).none { it.name == FirebaseApp.DEFAULT_APP_NAME }) {
        val app = FirebaseApp.initializeApp(context.applicationContext, config)
        app.setDataCollectionDefaultEnabled(false)
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
      }
    } catch (_: Exception) {
      // Missing/invalid local public settings must never prevent the WebView opening.
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }
  }

  @Synchronized
  fun configure(context: Context, values: Map<String, String>, origin: String) {
    val address = URI(origin)
    require(address.scheme == "https" && address.host != null && address.userInfo == null &&
      address.rawQuery == null && address.rawFragment == null && (address.path == "" || address.path == "/")) { "Invalid instance origin" }
    val config = options(context, values)
    val old = FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
    if (old != null && old.options != config) {
      // Retire the former project's token before reusing Firebase's default app name.
      FirebaseMessaging.getInstance().isAutoInitEnabled = false
      Tasks.await(FirebaseMessaging.getInstance().deleteToken(), 10, TimeUnit.SECONDS)
      old.delete()
    }
    if (FirebaseApp.getApps(context).none { it.name == FirebaseApp.DEFAULT_APP_NAME }) {
      FirebaseApp.initializeApp(context.applicationContext, config).setDataCollectionDefaultEnabled(false)
    }
    val publicValues = mapOf("projectId" to config.projectId, "appId" to config.applicationId,
      "apiKey" to config.apiKey, "messagingSenderId" to config.gcmSenderId, "packageName" to context.packageName)
    check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("config", JSONObject(publicValues).toString()).putString("origin", origin).commit()) { "Could not save Firebase configuration" }
    FirebaseMessaging.getInstance().isAutoInitEnabled = true
  }
}

class OmnixFirebaseModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OmnixFirebase")
    Function("packageName") { appContext.reactContext?.packageName ?: "" }
    AsyncFunction("configure") { config: Map<String, String>, origin: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("E_FIREBASE_CONFIG", "Application context unavailable", null)
      } else {
        RuntimeFirebase.executor.execute {
          try {
            RuntimeFirebase.configure(context, config, origin)
            promise.resolve(null)
          } catch (_: Exception) {
            promise.reject("E_FIREBASE_CONFIG", "Could not initialize this instance's Firebase configuration. Check Integrations and Google Play services.", null)
          }
        }
      }
    }
  }
}
