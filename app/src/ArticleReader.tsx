import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { articleUrl } from "./protocol";

export default function ArticleReader({
  article,
  onClose,
  workspaceOrigin
}: {
  article: { url: string; title: string };
  onClose: () => void;
  workspaceOrigin: string;
}) {
  const web = useRef<WebView<object>>(null);
  const [address, setAddress] = useState(article.url),
    [entry, setEntry] = useState(article.url),
    [back, setBack] = useState(false),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false);
  const goBack = () => (back ? web.current?.goBack() : onClose());
  return (
    <Modal
      animationType="slide"
      onRequestClose={goBack}
      presentationStyle="fullScreen"
    >
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={back ? "Back within article" : "Back to Omnix"}
            onPress={goBack}
            style={styles.action}
          >
            <Text style={styles.arrow}>←</Text>
          </Pressable>
          <View style={styles.publisher}>
            <View style={styles.domainRow}>
              <Text numberOfLines={1} style={styles.domain}>
                {new URL(address).hostname.replace(/^www\./, "")}
              </Text>
              <Text style={styles.badge}>.app</Text>
            </View>
            <Text numberOfLines={1} style={styles.title}>
              {article.title || "Article"}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close article"
            onPress={onClose}
            style={styles.action}
          >
            <Text style={styles.arrow}>×</Text>
          </Pressable>
        </View>
        {loading && (
          <ActivityIndicator
            accessibilityLabel="Loading article"
            color="#fff"
            style={styles.loading}
          />
        )}
        {failed ? (
          <View style={styles.error}>
            <Text style={styles.errorTitle}>Could not load this article.</Text>
            <Text style={styles.copy}>
              The publisher may require a browser or a network connection.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setFailed(false);
                setEntry(address);
                setLoading(true);
              }}
              style={styles.retry}
            >
              <Text style={styles.label}>RETRY</Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(address).catch(() => {})}
              style={styles.retry}
            >
              <Text style={styles.label}>OPEN IN BROWSER ↗</Text>
            </Pressable>
          </View>
        ) : (
          <WebView<object>
            ref={web}
            source={{ uri: entry }}
            style={styles.web}
            // Android incognito clears the process-wide cookie jar, including sign-in.
            incognito={Platform.OS === "ios"}
            sharedCookiesEnabled={false}
            thirdPartyCookiesEnabled={false}
            geolocationEnabled={false}
            allowFileAccess={false}
            mixedContentMode="never"
            // Handle every scheme here: WebView's whitelist fallback opens external apps.
            originWhitelist={["*"]}
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows={false}
            allowsBackForwardNavigationGestures
            onShouldStartLoadWithRequest={(request) => {
              const url = articleUrl(request.url);
              return (
                Boolean(url && new URL(url).origin !== workspaceOrigin) ||
                (request.isTopFrame === false &&
                  ["about:blank", "about:srcdoc"].includes(request.url))
              );
            }}
            onNavigationStateChange={(state) => {
              const url = articleUrl(state.url);
              if (url) setAddress(url);
              setBack(state.canGoBack);
            }}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={(event) => {
              const failedUrl = articleUrl(event.nativeEvent.url);
              if (failedUrl && new URL(failedUrl).origin !== workspaceOrigin)
                setAddress(failedUrl);
              setFailed(true);
              setBack(false);
              setLoading(false);
            }}
            onHttpError={(event) => {
              if (event.nativeEvent.statusCode >= 400) {
                const failedUrl = articleUrl(event.nativeEvent.url);
                if (failedUrl && new URL(failedUrl).origin !== workspaceOrigin)
                  setAddress(failedUrl);
                setFailed(true);
                setBack(false);
                setLoading(false);
              }
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  web: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: "#090909"
  },
  action: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  arrow: { color: "#fff", fontSize: 24 },
  publisher: { flex: 1, gap: 4 },
  domainRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  domain: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "SpaceGrotesk_400Regular",
    flexShrink: 1
  },
  badge: { color: "#aaa", fontSize: 11, fontFamily: "SpaceMono_400Regular" },
  title: { color: "#999", fontSize: 11, fontFamily: "SpaceMono_400Regular" },
  loading: { padding: 8 },
  error: { flex: 1, justifyContent: "center", padding: 28, gap: 20 },
  errorTitle: {
    color: "#fff",
    fontSize: 24,
    fontFamily: "SpaceGrotesk_400Regular"
  },
  copy: {
    color: "#aaa",
    fontSize: 16,
    lineHeight: 24,
    fontFamily: "SpaceGrotesk_400Regular"
  },
  retry: {
    minHeight: 48,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingRight: 20
  },
  label: { color: "#fff", fontSize: 12, fontFamily: "SpaceMono_400Regular" }
});
