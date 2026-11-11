# Omnix companion

An Expo app for Android and iOS. The workspace runs inside a WebView. Pocket ID sign-in runs in the system browser, using the existing Omnix OIDC client and callback URL.

## Pair

1. Deploy this server version behind your HTTPS tunnel.
2. Open **Settings → Companion app** in Omnix.
3. Scan the QR code in the companion, or enter the HTTPS instance address.
4. Sign in through the workspace with Pocket ID and select **Connect this device** in the browser. No pairing number is needed.
5. Select **Return to Omnix app**. A short-lived, one-use ticket establishes the WebView's regular HttpOnly session.

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

Use a native development build or a compiled app for the `omnix://` authentication callback. Expo Go cannot register this app's custom scheme. Native projects are generated and ignored by Git. Camera permission is optional when entering the address manually. Android back navigation and connection retry are supported.

## GitHub builds

The **Companion app** workflow runs on relevant PRs, main pushes, `mobile-v*` tags and manual dispatch. After both native builds pass, main builds publish a preview under [GitHub Releases](https://github.com/bizbazboz/Omnix/releases). Pushing a `mobile-v*` tag publishes a versioned companion release. Manual runs publish when run against main or a mobile version tag; PRs and other branches only upload Actions artifacts. Companion releases do not replace the repository's global latest release.

Download **omnix-android-preview.apk** directly from the release for an installable Android release-mode APK using the template's preview/debug signing identity. It is a testing build, not a Play Store release. **omnix-ios-simulator.zip** contains an unsigned simulator app; physical iOS distribution requires your Apple signing identity and provisioning profile. **SHA256SUMS** provides download checksums. Native SDKs and builds run on GitHub runners; no Expo cloud account or EAS token is needed. The original Actions artifacts remain available for debugging.

Store-signed releases should use your own signing credentials; never commit a keystore or provisioning profile. The pinned `glob` and `minimatch` overrides address build-tool advisories in the current Expo dependency tree; keep them until Expo's declared versions include the fixes.
