// Native projects are generated. Production signing is injected after prebuild.
const fs = require("node:fs");
const path = require("node:path");
if (process.env.EXPO_PUBLIC_OMNIX_CHANNEL === "production") {
  for (const key of [
    "OMNIX_ANDROID_KEYSTORE",
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_PASSWORD"
  ])
    if (!process.env[key])
      throw new Error("Missing production signing configuration: " + key);
  if (!fs.existsSync(process.env.OMNIX_ANDROID_KEYSTORE))
    throw new Error("Production keystore unavailable");
  const file = path.join(__dirname, "../app/android/app/build.gradle");
  let source = fs.readFileSync(file, "utf8");
  if (!source.includes("signingConfig signingConfigs.debug"))
    throw new Error("Unexpected generated Gradle signing template");
  source = source.replace(
    "signingConfigs {",
    `signingConfigs {
        production {
            storeFile file(System.getenv("OMNIX_ANDROID_KEYSTORE"))
            storeType "PKCS12"
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }`
  );
  source = source.replace(
    /release\s*\{([\s\S]*?)signingConfig signingConfigs\.debug/,
    (_, block) =>
      "release {" + block + "signingConfig signingConfigs.production"
  );
  if (
    !/release\s*\{[\s\S]*?signingConfig signingConfigs\.production/.test(source)
  )
    throw new Error("Production signing was not installed");
  fs.writeFileSync(file, source);
  console.log(
    "Production release signing configured; no credentials written to Gradle."
  );
} else {
  console.log("Preview channel uses its separate application identity.");
}
