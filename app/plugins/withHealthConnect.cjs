const {
  withAndroidManifest,
  withGradleProperties
} = require("expo/config-plugins");
module.exports = (config) => {
  config = withGradleProperties(config, (config) => {
    const values = config.modResults.filter(
      (value) => value.key !== "android.minSdkVersion"
    );
    values.push({
      type: "property",
      key: "android.minSdkVersion",
      value: "26"
    });
    config.modResults = values;
    return config;
  });
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest["uses-permission"] ??= [];
    for (const type of [
      "STEPS",
      "DISTANCE",
      "WEIGHT",
      "TOTAL_CALORIES_BURNED",
      "EXERCISE",
      "SLEEP",
      "ACTIVE_CALORIES_BURNED",
      "HEART_RATE",
      "OXYGEN_SATURATION",
      "BLOOD_PRESSURE",
      "BLOOD_GLUCOSE",
      "BODY_FAT",
      "BASAL_METABOLIC_RATE",
      "HEIGHT",
      "VO2_MAX",
      "POWER",
      "SPEED",
      "NUTRITION"
    ]) {
      const name = "android.permission.health.READ_" + type;
      if (
        !manifest["uses-permission"].some((p) => p.$["android:name"] === name)
      )
        manifest["uses-permission"].push({ $: { "android:name": name } });
    }
    manifest.queries ??= [{}];
    manifest.queries[0].package ??= [];
    if (
      !manifest.queries[0].package.some(
        (p) => p.$["android:name"] === "com.google.android.apps.healthdata"
      )
    )
      manifest.queries[0].package.push({
        $: { "android:name": "com.google.android.apps.healthdata" }
      });
    const app = manifest.application[0];
    app.activity ??= [];
    const activity = "expo.modules.omnixfirebase.HealthPrivacyActivity";
    if (!app.activity.some((a) => a.$["android:name"] === activity))
      app.activity.push({
        $: { "android:name": activity, "android:exported": "true" },
        "intent-filter": [
          {
            action: [
              {
                $: {
                  "android:name":
                    "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE"
                }
              }
            ]
          }
        ]
      });
    app["activity-alias"] ??= [];
    if (
      !app["activity-alias"].some(
        (a) => a.$["android:name"] === "ViewHealthPermissionUsageActivity"
      )
    )
      app["activity-alias"].push({
        $: {
          "android:name": "ViewHealthPermissionUsageActivity",
          "android:exported": "true",
          "android:targetActivity": activity,
          "android:permission": "android.permission.START_VIEW_PERMISSION_USAGE"
        },
        "intent-filter": [
          {
            action: [
              {
                $: {
                  "android:name": "android.intent.action.VIEW_PERMISSION_USAGE"
                }
              }
            ],
            category: [
              {
                $: {
                  "android:name": "android.intent.category.HEALTH_PERMISSIONS"
                }
              }
            ]
          }
        ]
      });
    return config;
  });
};
