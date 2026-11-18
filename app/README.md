# Omnix companion

An Expo app for Android and iOS. The workspace runs inside a WebView. Pocket ID sign-in runs in the system browser, using the existing Omnix OIDC client and callback URL.

Android builds require Android 8 (API 26) or newer. Health Connect needs Android 9+ and a supported, updated provider; Android 14+ includes the provider in the OS.

## Pair

1. Deploy this server version behind your HTTPS tunnel.
2. Open **Settings → Companion app** in Omnix.
3. Scan the QR code in the companion, or enter the HTTPS instance address.
4. Sign in through the workspace with Pocket ID and select **Connect this device** in the browser. No pairing number is needed.
5. Select **Return to Omnix app**. The app checks the returned request ID and proof-bound one-use grant before establishing the WebView session.

The QR contains only the instance address. Approval expires after five minutes. A verifier held by the initiating app binds the exchange; the WebView ticket expires after 30 seconds. API tokens cannot approve a device. Only the instance address is saved in SecureStore. Scanning opens the instance directly without a confirmation popup. Once connected, the app is a full-screen WebView without a native navigation toolbar. Use the workspace sign-out control to end a session.

## Development

Native setup, scanning and recovery screens follow the same Nothing-inspired dark design as the workspace: OLED black, Doto display headings, Space Grotesk body text and Space Mono controls. Font files are bundled locally. The connected workspace fills the WebView without native navigation chrome.

```sh
cd app
npm ci
npm run lint
npm run check
npm test
npx expo prebuild
npx expo run:android
# On macOS:
npx expo run:ios
```

Use a native development build or a compiled app for the `omnix-preview://` (default) or `omnix://` (production) authentication callback. Expo Go cannot register this app's custom scheme. Native projects are generated and ignored by Git. Camera permission is optional when entering the address manually. Android back navigation and connection retry are supported.

## Firebase notifications

Push is Android companion only and goes directly through Firebase Cloud Messaging v1; no Expo account or Expo Push Service is used. In Omnix, upload the Firebase **service-account JSON key** under Settings → Integrations → Firebase. It remains encrypted on the server. Enable email/news alerts in the companion's Notifications settings and use Send test. Notification taps open the matching message or headline in the full-screen WebView.

Upload the public `google-services.json` from Firebase Project settings → Your apps to the same server integration. Include the companion package `com.bizbazboz.omnix` and, if needed, `com.bizbazboz.omnix.preview`; additional client files can be added later without uploading the private key again. The app fetches only the public options for its own package after sign-in, initializes Firebase at runtime, and restores those cached public options at process startup for background delivery. The same APK works with different instances and Firebase projects. No app `.env`, Firebase build variable, bundled Firebase file or per-instance rebuild is needed. Enable FCM HTTP v1 and grant the sending service account Firebase Cloud Messaging API Admin. iPhone push is not part of this Android setup.

## Walking route exports

**Health → Walking loops → Export GPX** opens Android's native Save-as dialog. Choose Downloads or another document provider; cancelling does not report a saved file. No broad storage permission is needed. On iOS, the native share sheet offers Save to Files or a compatible route app. Ordinary browser downloads remain available. Routes stay client-side until you explicitly export them; no server upload is introduced. Native exports are limited to 2 MB. The iOS export cache retains at most ten route files.

## Android Health Connect

Open **Settings → Integrations → Health from your phone** inside the Android companion. Select steps, distance, exercise duration and/or sleep, then **Connect this phone**. Android requests read access only for the selected categories. The app never requests write, location, medical-record or background-health permissions. Health Connect settings include a public permission rationale explaining storage and removal.

The first sync reads daily aggregates for the last 28 days. Android's aggregation API handles overlapping activity/sleep sources according to the phone's priority settings. Later foreground syncs check changes, re-read the bounded window when needed, and replace daily totals rather than adding them. Sync runs on foreground return and every five minutes while open; **Sync phone now** forces a refresh. No background delivery is promised. Offline failures retain the server's existing history and change cursor so a later foreground/manual attempt can retry.

Readings upload through the current signed-in WebView session, remain private to its account and are encrypted in the server database. Revision checks prevent stale settings or old device snapshots from replacing newer data; retrying the same accepted batch does not duplicate totals. No app `.env`, cloud Health key or extra OAuth client is needed. Only one phone is the active source for an account; connecting another retains saved history and changes the active device.

Google Health cloud support has been retired. Upgrading archives previously saved readings, deletes Google Health OAuth credentials and registration, and stops cloud sync jobs. Health Connect is the only live health source. Phone totals replace overlapping archived days without being summed. Different timezones retain their original daily boundaries. Pause retains saved phone readings; Forget removes phone readings only. Apple Health is not supported.

## Release builds

The **Companion app** workflow runs on relevant PRs, main pushes, `mobile-v*` tags and manual dispatch. After both native builds pass, main builds publish a prerelease under [GitHub Releases](https://github.com/bizbazboz/Omnix/releases), using the production Android package and private signing certificate. Pushing a `mobile-v*` tag publishes a versioned companion release. Manual runs publish when run against main or a mobile version tag; PRs and other branches only upload Actions artifacts. Companion releases do not replace the repository's global latest release.

Download **omnix-android.apk** from a main or versioned release for Android. PR and feature-branch artifacts are **Omnix Preview**, with a separate preview package, callback scheme and template signing identity. They intentionally do not claim production website links. GitHub downloads do not publish an app to the Play Store. **omnix-ios-simulator.zip** contains an unsigned simulator app; physical iOS distribution requires your Apple signing identity and provisioning profile. **SHA256SUMS** provides download checksums. Native SDKs and builds run on GitHub runners; no Expo cloud account or EAS token is needed. The original Actions artifacts remain available for debugging.

Store-signed releases should use your own signing credentials; never commit a keystore or provisioning profile. The pinned `glob` and `minimatch` overrides address build-tool advisories in the current Expo dependency tree; keep them until Expo's declared versions include the fixes.

## Production signing and upgrades

Main and `mobile-v*` builds use `com.bizbazboz.omnix` and the `omnix` callback. PR and feature-branch builds use `com.bizbazboz.omnix.preview` and `omnix-preview`. Production signing requires protected Actions secrets `ANDROID_KEYSTORE_BASE64` (PKCS12), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` and `ANDROID_CERT_SHA256`; the workflow refuses missing keys and checks the built certificate. Temporary runner key files are deleted after builds. Preserve the private signing identity for future updates.

Earlier debug-signed previews used the production package ID. Those installations cannot be updated in place to the private production certificate: uninstall the old preview, install the private-signed release and pair again. Server and companion should be upgraded together for the browser-return grant protocol. No additional Pocket ID callback registration is needed.

Moving from the separate preview package also requires pairing the production app. Disable notifications in the old preview or uninstall it to avoid duplicate alerts. Existing privately signed production installations update in place.

## Verified Android website links

Production APKs claim workspace links on `https://omnix.bizbazboz.uk`; preview APKs do not. The server publishes `/.well-known/assetlinks.json` with the production signing-certificate fingerprint. Administrators can rotate public fingerprints in Settings → Companion app. Deploy the updated server and matching signed production app together, then verify Android Open by default/domain verification on a physical device. API/OIDC callback URLs stay in the system browser. Arbitrary self-hosted origins still use QR pairing; claiming another domain requires a manifest change and rebuild. See the [Companion wiki guide](https://github.com/bizbazboz/Omnix/wiki/Companion) for verification commands.

Inside the Android companion, **Settings → Companion app → Link handling on this device** shows the installed package, Android's domain-verification state and whether link handling is allowed. **Open app settings** opens Android's controls; **Refresh status** reads them again. A preview package showing no verified domains is expected.
