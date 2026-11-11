import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  Image,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { useFonts } from "expo-font";
import { SpaceGrotesk_400Regular } from "@expo-google-fonts/space-grotesk/400Regular";
import { SpaceMono_400Regular } from "@expo-google-fonts/space-mono/400Regular";
import { Doto_600SemiBold } from "@expo-google-fonts/doto/600SemiBold";
import {
  AUTH_RETURN,
  base64url,
  instanceOrigin,
  internalNavigation,
  loginNavigation,
  pairingOrigin
} from "./protocol";
WebBrowser.maybeCompleteAuthSession();
const INSTANCE_KEY = "omnix.instance";
type Source = {
  uri: string;
  headers?: Record<string, string>;
};
export default function App({ children }: { children?: ReactNode }) {
  const [fonts] = useFonts({ SpaceGrotesk_400Regular, SpaceMono_400Regular, Doto_600SemiBold });
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Companion fonts={fonts} />
      {children}
    </SafeAreaProvider>
  );
}
function Companion({ fonts }: { fonts: boolean }) {
  const [origin, setOrigin] = useState(""),
    [entry, setEntry] = useState(""),
    [loaded, setLoaded] = useState(false),
    [source, setSource] = useState<Source>(),
    [scan, setScan] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [webError, setWebError] = useState(false),
    [inputFocused, setInputFocused] = useState(false),
    [back, setBack] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const web = useRef<WebView<object>>(null),
    signingIn = useRef(false),
    scanned = useRef(false),
    currentOrigin = useRef(origin);
  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(INSTANCE_KEY)
      .then((value) => {
        if (active && value) {
          const saved = instanceOrigin(value);
          currentOrigin.current = saved;
          setOrigin(saved);
          setSource({ uri: saved });
        }
      })
      .catch(() => {
        if (active) setError("Could not read the saved instance address.");
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (scan) {
        setScan(false);
        return true;
      }
      if (back) {
        web.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [scan, back]);
  const connect = useCallback(async (address: string) => {
    setBusy(true);
    setError("");
    try {
      await SecureStore.setItemAsync(INSTANCE_KEY, address);
      currentOrigin.current = address;
      setOrigin(address);
      setSource({ uri: address });
      setWebError(false);
      setScan(false);
    } catch {
      setError("Could not save this instance. Try again.");
    } finally {
      setBusy(false);
      scanned.current = false;
    }
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const receive = (url: string) => {
      if (!/^omnix:\/\/pair\/?\?/.test(url)) return;
      try {
        void connect(pairingOrigin(url));
      } catch (error) {
        setError((error as Error).message);
      }
    };
    void Linking.getInitialURL().then((url) => {
      if (url) receive(url);
    });
    const sub = Linking.addEventListener("url", ({ url }) => receive(url));
    return () => sub.remove();
  }, [loaded, connect]);
  async function call<T>(
    address: string,
    path: string,
    body: unknown
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(address + path, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          typeof value.detail === "string"
            ? value.detail
            : "Could not connect. Check the instance and try again."
        );
      return value as T;
    } finally {
      clearTimeout(timeout);
    }
  }
  async function signIn() {
    if (signingIn.current || !origin) return;
    signingIn.current = true;
    setBusy(true);
    setError("");
    const address = origin;
    try {
      const verifier = base64url(await Crypto.getRandomBytesAsync(32));
      const digest = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        verifier,
        { encoding: Crypto.CryptoEncoding.BASE64 }
      );
      const challenge = digest
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const pairing = await call<{
        request_id: string;
        login_url: string;
      }>(address, "/api/v1/mobile/requests", {
        challenge,
        platform: Platform.OS === "ios" ? "ios" : "android"
      });
      if (
        !internalNavigation(pairing.login_url, address) ||
        !/^[\w-]{43}$/.test(pairing.request_id)
      )
        throw new Error("The server returned an invalid sign-in request.");
      const result = await WebBrowser.openAuthSessionAsync(
        pairing.login_url,
        AUTH_RETURN
      );
      if (result.type !== "success") {
        setError("Sign-in was cancelled. Try again when you are ready.");
        return;
      }
      if (![AUTH_RETURN, AUTH_RETURN + "/"].includes(result.url))
        throw new Error("Unexpected sign-in callback.");
      const session = await call<{
        ticket: string;
      }>(address, "/api/v1/mobile/exchange", {
        request_id: pairing.request_id,
        verifier
      });
      if (!/^[\w-]{40,128}$/.test(session.ticket))
        throw new Error("The server returned an invalid session.");
      if (currentOrigin.current === address) {
        setWebError(false);
        setSource({
          uri: address + "/api/v1/mobile/session",
          headers: { "X-Omnix-Mobile-Ticket": session.ticket }
        });
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      signingIn.current = false;
      setBusy(false);
    }
  }
  function navigate(
    request: WebViewNavigation & {
      isTopFrame?: boolean;
    }
  ) {
    if (loginNavigation(request.url, origin)) {
      void signIn();
      return false;
    }
    if (internalNavigation(request.url, origin)) return true;
    if (
      request.isTopFrame === false &&
      ["about:blank", "about:srcdoc"].includes(request.url)
    )
      return true;
    if (/^(https:|mailto:|tel:)/.test(request.url))
      void Linking.openURL(request.url).catch(() =>
        setError("Could not open this link.")
      );
    return false;
  }
  const font = fonts ? { fontFamily: "SpaceGrotesk_400Regular" } : {};
  const labelFont = fonts ? { fontFamily: "SpaceMono_400Regular" } : {};
  const displayFont = fonts ? { fontFamily: "Doto_600SemiBold" } : {};
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {!loaded ? (
        <View style={styles.centered} accessibilityRole="progressbar" accessibilityLabel="Opening workspace">
          <Text style={[styles.label, labelFont]}>[OPENING WORKSPACE...]</Text>
        </View>
      ) : !origin || scan ? (
        <ScrollView
          contentContainerStyle={styles.pairing}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.brandRow}>
            <Image
              source={require("../assets/omnix.png")}
              style={styles.logo}
              accessible={false}
            />
            <Text style={[styles.brand, font]}>omnix</Text>
            <Text style={[styles.label, labelFont]}>COMPANION</Text>
          </View>
          <View style={styles.hero}>
            <Text accessibilityRole="header" style={[styles.title, displayFont]}>
              {scan ? "Scan.\nConnect." : "Your space.\nAnywhere."}
            </Text>
            <Text style={[styles.copy, font]}>
              {scan ? "Point your camera at the QR in Companion settings." : "Scan the QR in Companion settings, or enter your instance address."}
            </Text>
          </View>
          {scan && permission?.granted ? (
            <CameraView
              style={styles.camera}
              accessibilityLabel="Scan an Omnix instance QR code"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                if (scanned.current) return;
                scanned.current = true;
                try {
                  void connect(pairingOrigin(data));
                } catch (error) {
                  setError((error as Error).message);
                  scanned.current = false;
                }
              }}
            />
          ) : (
            <>
              <Text style={[styles.label, labelFont]}>INSTANCE ADDRESS</Text>
              <TextInput
                accessibilityLabel="Instance address"
                style={[styles.input, labelFont, inputFocused && styles.inputFocused, !!error && styles.inputError]}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                value={entry}
                onChangeText={setEntry}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://omnix.example.com"
                placeholderTextColor="#999999"
                selectionColor="#FFFFFF"
                returnKeyType="go"
                onSubmitEditing={() => {
                  if (busy) return;
                  try { void connect(instanceOrigin(entry)); }
                  catch (error) { setError((error as Error).message); }
                }}
                editable={!busy}
              />
              {
                <ActionButton
                  label={busy ? "Connecting..." : "Connect"}
                  onPress={() => {
                    try {
                      void connect(instanceOrigin(entry));
                    } catch (error) {
                      setError((error as Error).message);
                    }
                  }}
                  primary={true}
                  disabled={busy}
                  fonts={fonts}
                />
              }
              {
                <ActionButton
                  label={"Scan QR code"}
                  onPress={() => {
                    void (async () => {
                      const value = permission?.granted
                        ? permission
                        : await requestPermission();
                      if (value.granted) {
                        setScan(true);
                        scanned.current = false;
                        setError("");
                      } else
                        setError(
                          "Camera access is needed to scan. You can enter the address instead."
                        );
                    })();
                  }}
                  primary={false}
                  disabled={busy}
                  fonts={fonts}
                />
              }
            </>
          )}
          {scan && (
            <ActionButton
              label={"Cancel scan"}
              onPress={() => setScan(false)}
              primary={false}
              disabled={busy}
              fonts={fonts}
            />
          )}
          {error ? (
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, font]}>
              {error}
            </Text>
          ) : null}
        </ScrollView>
      ) : (
        <>
          {busy && (
            <View style={styles.notice}>
              <Text accessibilityLiveRegion="polite" style={[styles.label, labelFont]}>[SIGNING IN...]</Text>
            </View>
          )}
          {error ? (
            <View style={styles.notice}>
              <Text accessibilityRole="alert" style={[styles.error, font]}>
                {error}
              </Text>
              <ActionButton
                label="Try sign-in again"
                onPress={() => void signIn()}
                disabled={busy}
                fonts={fonts}
              />
            </View>
          ) : null}
          {webError ? (
            <View style={styles.pairing}>
              <Text style={[styles.label, labelFont]}>CONNECTION / OFFLINE</Text>
              <Text accessibilityRole="header" style={[styles.title, displayFont]}>Try again.</Text>
              <Text style={[styles.copy, font]}>Check your connection and reload the workspace.</Text>
              {
                <ActionButton
                  label={"Retry"}
                  onPress={() => {
                    setWebError(false);
                    setSource({ uri: origin });
                  }}
                  primary={true}
                  disabled={busy}
                  fonts={fonts}
                />
              }
            </View>
          ) : (
            source && (
              <WebView<object>
                ref={web}
                source={source}
                style={styles.web}
                sharedCookiesEnabled
                geolocationEnabled
                thirdPartyCookiesEnabled={false}
                originWhitelist={["https://*", "about:blank", "about:srcdoc"]}
                allowsBackForwardNavigationGestures
                mixedContentMode="never"
                allowFileAccess={false}
                javaScriptCanOpenWindowsAutomatically={false}
                setSupportMultipleWindows={false}
                onShouldStartLoadWithRequest={navigate}
                onNavigationStateChange={(state) => setBack(state.canGoBack)}
                onError={() => setWebError(true)}
                onHttpError={(event) => {
                  if (event.nativeEvent.statusCode >= 500) setWebError(true);
                }}
                startInLoadingState
                renderLoading={() => (
                  <View style={styles.loading} pointerEvents="none">
                    <Text accessibilityRole="progressbar" accessibilityLabel="Loading workspace" style={[styles.label, labelFont]}>[LOADING...]</Text>
                  </View>
                )}
              />
            )
          )}
        </>
      )}
    </SafeAreaView>
  );
}
function ActionButton({
  label,
  onPress,
  primary = false,
  disabled,
  fonts
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled: boolean;
  fonts: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.primary,
        pressed && styles.pressed,
        disabled && { opacity: 0.5 }
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          fonts && { fontFamily: "SpaceMono_400Regular" },
          primary && { color: "#000" }
        ]}
      >
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  web: { flex: 1, backgroundColor: "#000" },
  pairing: { flexGrow: 1, width: "100%", maxWidth: 560, alignSelf: "center", padding: 24, paddingTop: 32, paddingBottom: 48, gap: 16 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 48 },
  logo: { width: 32, height: 32 },
  brand: { flex: 1, color: "#E8E8E8", fontSize: 16 },
  hero: { gap: 16, marginBottom: 32 },
  title: { color: "#FFFFFF", fontSize: 48, lineHeight: 54, letterSpacing: -1 },
  copy: { color: "#999999", fontSize: 16, lineHeight: 24 },
  label: { color: "#999999", fontSize: 12, lineHeight: 18, letterSpacing: 0.8 },
  input: {
    borderBottomWidth: 1,
    borderColor: "#333333",
    paddingVertical: 16,
    paddingHorizontal: 0,
    marginTop: -8,
    marginBottom: 16,
    minHeight: 56,
    color: "#E8E8E8",
    fontSize: 16
  },
  inputFocused: { borderColor: "#E8E8E8" },
  inputError: { borderColor: "#D71921" },
  button: {
    minHeight: 56,
    paddingHorizontal: 24,
    paddingVertical: 16,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#333333",
    borderRadius: 999
  },
  primary: { backgroundColor: "#fff", borderColor: "#fff" },
  pressed: { opacity: 0.7 },
  buttonText: { color: "#E8E8E8", fontSize: 12, lineHeight: 18, letterSpacing: 0.8, textAlign: "center" },
  error: { color: "#E8E8E8", borderLeftWidth: 2, borderLeftColor: "#D71921", paddingLeft: 16, paddingVertical: 8, fontSize: 16, lineHeight: 24 },
  camera: { width: "100%", aspectRatio: 1, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "#333333" },
  notice: { gap: 16, padding: 24, backgroundColor: "#111111" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  loading: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#000000" }
});
