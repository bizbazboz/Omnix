const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("production signing fails closed and never embeds secret values", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omnix-signing-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"));
    fs.mkdirSync(path.join(root, "app/android/app"), { recursive: true });
    const script = path.join(root, "scripts/configure_android_signing.cjs");
    fs.copyFileSync(
      path.join(__dirname, "configure_android_signing.cjs"),
      script
    );
    const gradle = path.join(root, "app/android/app/build.gradle");
    const original =
      "android { signingConfigs { debug {} } buildTypes { debug { signingConfig signingConfigs.debug } release { signingConfig signingConfigs.debug } } }";
    fs.writeFileSync(gradle, original);
    const env = { ...process.env, EXPO_PUBLIC_OMNIX_CHANNEL: "production" };
    for (const key of [
      "OMNIX_ANDROID_KEYSTORE",
      "ANDROID_KEYSTORE_PASSWORD",
      "ANDROID_KEY_ALIAS",
      "ANDROID_KEY_PASSWORD"
    ])
      delete env[key];
    assert.notEqual(spawnSync(process.execPath, [script], { env }).status, 0);
    assert.equal(fs.readFileSync(gradle, "utf8"), original);
    const keyFile = path.join(root, "dummy.p12");
    fs.writeFileSync(keyFile, "test fixture only");
    Object.assign(env, {
      OMNIX_ANDROID_KEYSTORE: keyFile,
      ANDROID_KEYSTORE_PASSWORD: "private-test-value",
      ANDROID_KEY_ALIAS: "private-alias",
      ANDROID_KEY_PASSWORD: "private-test-value"
    });
    const result = spawnSync(process.execPath, [script], {
      env,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    const configured = fs.readFileSync(gradle, "utf8");
    assert.match(
      configured,
      /release\s*\{\s*signingConfig signingConfigs.production/
    );
    assert.match(configured, /debug\s*\{\s*signingConfig signingConfigs.debug/);
    assert(!configured.includes("private-test-value"));
    assert(!configured.includes("private-alias"));
    fs.writeFileSync(gradle, original);
    assert.equal(
      spawnSync(process.execPath, [script], {
        env: { ...env, EXPO_PUBLIC_OMNIX_CHANNEL: "preview" }
      }).status,
      0
    );
    assert.equal(fs.readFileSync(gradle, "utf8"), original);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("omnix-signing-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
