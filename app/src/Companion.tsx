import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  ActivityIndicator,
  Image,
  Alert,
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
  const [fonts] = useFonts({ SpaceGrotesk_400Regular });
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
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [webError, setWebError] = useState(false),
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
  const confirmAddress = useCallback(
    (address: string) => {
      Alert.alert("Connect to Omnix", address, [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => {
            scanned.current = false;
          }
        },
        {
          text: "Connect",
          onPress: () => {
            void connect(address);
          }
        }
      ]);
    },
    [connect]
  );
  useEffect(() => {
    if (!loaded) return;
    const receive = (url: string) => {
      if (!/^omnix:\/\/pair\/?\?/.test(url)) return;
      try {
        confirmAddress(pairingOrigin(url));
      } catch (error) {
        setError((error as Error).message);
      }
    };
    void Linking.getInitialURL().then((url) => {
      if (url) receive(url);
    });
    const sub = Linking.addEventListener("url", ({ url }) => receive(url));
    return () => sub.remove();
  }, [loaded, confirmAddress]);
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
        code: string;
        login_url: string;
      }>(address, "/api/v1/mobile/requests", {
        challenge,
        platform: Platform.OS === "ios" ? "ios" : "android"
      });
      if (
        !internalNavigation(pairing.login_url, address) ||
        !/^[\w-]{43}$/.test(pairing.request_id) ||
        !/^\d{6}$/.test(pairing.code)
      )
        throw new Error("The server returned an invalid sign-in request.");
      setCode(pairing.code);
      const result = await WebBrowser.openAuthSessionAsync(
        pairing.login_url,
        AUTH_RETURN
      );
      if (result.type !== "success") return;
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
      setCode("");
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
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {!loaded ? (
        <ActivityIndicator color="#fff" />
      ) : !origin || scan ? (
        <ScrollView
          contentContainerStyle={styles.pairing}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              marginBottom: 32
            }}
          >
            <Image
              source={require("../assets/omnix.png")}
              style={{ width: 44, height: 44 }}
            />
            <Text style={[styles.brand, font, { marginBottom: 0 }]}>omnix</Text>
          </View>
          <Text style={[styles.title, font]}>
            Your workspace.{"\n"}On your phone.
          </Text>
          {scan && permission?.granted ? (
            <CameraView
              style={styles.camera}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                if (scanned.current) return;
                scanned.current = true;
                try {
                  confirmAddress(pairingOrigin(data));
                } catch (error) {
                  setError((error as Error).message);
                  scanned.current = false;
                }
              }}
            />
          ) : (
            <>
              <Text style={[styles.copy, font]}>
                Scan the code in Settings → Companion app, or enter your
                instance address.
              </Text>
              <TextInput
                accessibilityLabel="Instance address"
                style={[styles.input, font]}
                value={entry}
                onChangeText={setEntry}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://omnix.example.com"
                placeholderTextColor="#777"
                editable={!busy}
              />
              {
                <ActionButton
                  label={"Connect"}
                  onPress={() => {
                    try {
                      confirmAddress(instanceOrigin(entry));
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
                  label={"Scan pairing code"}
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
            <Text accessibilityRole="alert" style={[styles.error, font]}>
              {error}
            </Text>
          ) : null}
        </ScrollView>
      ) : (
        <>
          <View style={styles.toolbar}>
            <Text numberOfLines={1} style={[styles.host, font]}>
              {new URL(origin).host}
            </Text>
            {
              <ActionButton
                label={"Sign in"}
                onPress={() => {
                  void signIn();
                }}
                primary={false}
                disabled={busy}
                fonts={fonts}
              />
            }
            {
              <ActionButton
                label={"Reload"}
                onPress={() => {
                  setWebError(false);
                  setSource({ uri: origin });
                }}
                primary={false}
                disabled={busy}
                fonts={fonts}
              />
            }
            {
              <ActionButton
                label={"Instance"}
                onPress={() =>
                  Alert.alert("Instance", origin, [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Switch",
                      onPress: () => {
                        void SecureStore.deleteItemAsync(INSTANCE_KEY)
                          .then(() => {
                            currentOrigin.current = "";
                            setOrigin("");
                            setSource(undefined);
                            setBack(false);
                            setError("");
                          })
                          .catch(() =>
                            setError("Could not remove the saved instance.")
                          );
                      }
                    }
                  ])
                }
                primary={false}
                disabled={busy}
                fonts={fonts}
              />
            }
          </View>
          {busy && (
            <View style={styles.notice}>
              <ActivityIndicator color="#fff" />
              <Text style={[styles.copy, font]}>
                {code
                  ? "Confirm code " + code + " in your browser"
                  : "Connecting…"}
              </Text>
            </View>
          )}
          {error ? (
            <Text accessibilityRole="alert" style={[styles.error, font]}>
              {error}
            </Text>
          ) : null}
          {webError ? (
            <View style={styles.pairing}>
              <Text style={[styles.title, font]}>Connection interrupted.</Text>
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
                  <ActivityIndicator color="#fff" style={styles.loading} />
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
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        primary && styles.primary,
        disabled && { opacity: 0.5 }
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          fonts && { fontFamily: "SpaceGrotesk_400Regular" },
          primary && { color: "#000" }
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  web: { flex: 1, backgroundColor: "#000" },
  pairing: { flexGrow: 1, padding: 28, justifyContent: "center", gap: 20 },
  brand: { color: "#fff", fontSize: 30, marginBottom: 32 },
  title: { color: "#f5f5f5", fontSize: 36, letterSpacing: -1 },
  copy: { color: "#aaa", fontSize: 15, lineHeight: 23 },
  input: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 6,
    padding: 16,
    color: "#fff",
    fontSize: 16
  },
  button: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 6
  },
  primary: { backgroundColor: "#fff", borderColor: "#fff" },
  buttonText: { color: "#eee", fontSize: 14 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#222"
  },
  host: { flex: 1, color: "#aaa", fontSize: 13 },
  error: { color: "#ff7070", padding: 16, fontSize: 14 },
  camera: { height: 300, borderRadius: 8 },
  notice: { flexDirection: "row", gap: 12, alignItems: "center", padding: 16 },
  loading: { position: "absolute", top: "45%", alignSelf: "center" }
});
