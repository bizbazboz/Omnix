import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  AUTH_RETURN,
  appLinkNavigation,
  companionOpenNavigation,
  articleUrl,
  readerArticleUrl,
  nativeBridgeBootstrap,
  nativeBridgeMessage,
  mobileGrant,
  instanceOrigin,
  pairingOrigin,
  internalNavigation,
  notificationNavigation,
  firebaseClientForPackage,
  loginNavigation,
  base64url
} from "../src/protocol.ts";
const firebaseClient = {
  projectId: "omnix-project",
  appId: "1:123456789012:android:abcdef",
  apiKey: "AIza" + "a".repeat(35),
  messagingSenderId: "123456789012",
  packageName: "com.bizbazboz.omnix"
};
assert.deepEqual(
  firebaseClientForPackage(
    { clients: [{ ...firebaseClient, private_key: "never-native" }] },
    firebaseClient.packageName
  ),
  firebaseClient
);
assert.throws(() =>
  firebaseClientForPackage(
    { clients: [firebaseClient] },
    "com.bizbazboz.omnix.preview"
  )
);
assert.throws(() =>
  firebaseClientForPackage(
    { clients: [{ ...firebaseClient, apiKey: "invalid" }] },
    firebaseClient.packageName
  )
);
assert.equal(
  firebaseClientForPackage(
    { clients: [{ ...firebaseClient, projectId: "another-project" }] },
    firebaseClient.packageName
  ).projectId,
  "another-project"
);
assert.equal(
  notificationNavigation(
    { origin: "https://omnix.example.com", href: "/email/inbox?message=one" },
    "https://omnix.example.com"
  ),
  "https://omnix.example.com/email/inbox?message=one"
);
for (const data of [
  null,
  {},
  { origin: "https://other.test", href: "/email" },
  { origin: "https://omnix.example.com", href: "https://evil.test/email" },
  { origin: "https://omnix.example.com", href: "/api/v1/auth/logout" }
])
  assert.equal(
    notificationNavigation(data, "https://omnix.example.com"),
    undefined
  );
assert.equal(
  instanceOrigin(" https://omnix.example.com/ "),
  "https://omnix.example.com"
);
assert.equal(
  instanceOrigin("https://omnix.example.com:8443"),
  "https://omnix.example.com:8443"
);
assert.equal(
  pairingOrigin("omnix://pair?origin=https%3A%2F%2Fomnix.example.com"),
  "https://omnix.example.com"
);
assert.equal(
  pairingOrigin("omnix://pair/?origin=https%3A%2F%2Fomnix.example.com"),
  "https://omnix.example.com"
);
for (const value of [
  "http://example.com",
  "javascript:alert(1)",
  "https://user:password@example.com",
  "https://example.com/app",
  "https://example.com/?token=secret",
  "https://example.com/#private",
  "file:///data",
  "https://example.com:bad"
])
  assert.throws(() => instanceOrigin(value));
for (const value of [
  "https://example.com",
  "omnix://other?origin=https://example.com",
  "omnix://pair?origin=https://example.com&origin=https://evil.test",
  "omnix://pair?origin=http://example.com"
])
  assert.throws(() => pairingOrigin(value));
assert(internalNavigation("https://example.com/notes", "https://example.com"));
assert(
  !internalNavigation(
    "https://example.com.evil.test/notes",
    "https://example.com"
  )
);
assert(!internalNavigation("http://example.com", "https://example.com"));
assert(!internalNavigation("javascript:alert(1)", "https://example.com"));
assert(
  loginNavigation(
    "https://example.com/api/v1/auth/login?return_to=%2Fhealth",
    "https://example.com"
  )
);
assert(
  !loginNavigation("https://evil.test/api/v1/auth/login", "https://example.com")
);
assert.equal(
  AUTH_RETURN,
  process.env.EXPO_PUBLIC_OMNIX_CHANNEL === "production"
    ? "omnix://paired"
    : "omnix-preview://paired"
);
const grant = "a".repeat(54);
assert.equal(
  mobileGrant(`${AUTH_RETURN}?request=own&code=${grant}`, "own"),
  grant
);
for (const url of [
  `${AUTH_RETURN}?request=other&code=${grant}`,
  `${AUTH_RETURN}?request=own&code=${grant}&code=${grant}`,
  `https://paired?request=own&code=${grant}`,
  `${AUTH_RETURN}?request=own&code=short`,
  `${AUTH_RETURN}?request=own&code=${grant}#fragment`
])
  assert.throws(() => mobileGrant(url, "own"));
for (let length = 1; length <= 64; length++) {
  const bytes = randomBytes(length);
  assert.equal(base64url(bytes), bytes.toString("base64url"));
}
console.log(
  JSON.stringify({
    qrPairing: true,
    httpsOrigins: true,
    navigationBoundary: true,
    proofEncoding: true
  })
);

assert.equal(
  appLinkNavigation(
    "https://omnix.bizbazboz.uk/notes/projects/one?issue=two#details"
  ),
  "https://omnix.bizbazboz.uk/notes/projects/one?issue=two#details"
);
assert.equal(
  appLinkNavigation("https://omnix.bizbazboz.uk/"),
  "https://omnix.bizbazboz.uk/"
);
for (const url of [
  "https://evil.test/notes",
  "https://omnix.bizbazboz.uk.evil.test/notes",
  "https://user@omnix.bizbazboz.uk/notes",
  "http://omnix.bizbazboz.uk/notes",
  "https://omnix.bizbazboz.uk/api/v1/auth/callback?code=secret",
  "https://omnix.bizbazboz.uk/mobile/approve",
  "https://omnix.bizbazboz.uk/mcp",
  "https://omnix.bizbazboz.uk/notesevil",
  "https://omnix.bizbazboz.uk:8080/notes"
])
  assert.equal(appLinkNavigation(url), null);

const bridgeToken = "a".repeat(43);
const bbc = "https://www.bbc.co.uk/news/videos/c8p3vw4q6nzzo";
assert.equal(readerArticleUrl(bbc), bbc + ".app");
assert.equal(
  readerArticleUrl(bbc + "?utm_source=rss&view=full#watch"),
  bbc + ".app?utm_source=rss&view=full#watch"
);
assert.equal(readerArticleUrl(bbc + ".app?view=full"), bbc + ".app?view=full");
assert.equal(readerArticleUrl(bbc + "/?view=full"), bbc + ".app?view=full");
assert.equal(
  readerArticleUrl("https://www.bbc.co.uk.evil.test/news/article?view=full"),
  "https://www.bbc.co.uk.evil.test/news/article?view=full"
);
assert.equal(
  readerArticleUrl("https://example.com/news/article?view=full"),
  "https://example.com/news/article?view=full"
);
assert.equal(
  readerArticleUrl("https://www.bbc.co.uk/weather"),
  "https://www.bbc.co.uk/weather"
);
assert.equal(readerArticleUrl("javascript:alert(1)"), null);
const destination =
  "https://personal.example.test/notes/projects/one?issue=two#comments";
const openLink =
  AUTH_RETURN.split(":")[0] + "://open?url=" + encodeURIComponent(destination);
assert.equal(companionOpenNavigation(openLink), destination);
for (const url of [
  "http://personal.example.test/notes",
  "https://user:password@personal.example.test/notes",
  "https://personal.example.test/api/v1/auth/callback?code=secret",
  "https://personal.example.test/mcp",
  "https://personal.example.test/notes/../api/v1/me",
  "https://personal.example.test/notesevil",
  "javascript:alert(1)"
]) {
  assert.equal(
    companionOpenNavigation(
      AUTH_RETURN.split(":")[0] + "://open?url=" + encodeURIComponent(url)
    ),
    null
  );
}
assert.equal(
  companionOpenNavigation(openLink + "&url=" + encodeURIComponent(destination)),
  null
);
assert.equal(companionOpenNavigation(openLink + "&extra=unexpected"), null);
assert.equal(
  companionOpenNavigation(openLink.replace("://open?", "://evil?")),
  null
);
assert.equal(
  articleUrl("https://publisher.example.test/news?story=1"),
  "https://publisher.example.test/news?story=1"
);
for (const url of [
  "javascript:alert(1)",
  "file:///etc/passwd",
  "intent://open",
  "http://publisher.example.test",
  "https://user:secret@publisher.example.test",
  null,
  "x".repeat(8193)
])
  assert.equal(articleUrl(url), null);
assert(nativeBridgeBootstrap(bridgeToken).includes("window.top===window"));
assert.throws(() => nativeBridgeBootstrap("invalid"));
assert.equal(
  nativeBridgeMessage(
    JSON.stringify({ type: "omnix-push-register" }),
    bridgeToken
  ),
  null
);
assert.equal(
  nativeBridgeMessage(
    JSON.stringify({ type: "omnix-open-settings", bridgeToken: "forged" }),
    bridgeToken
  ),
  null
);
assert.equal(
  nativeBridgeMessage(
    JSON.stringify({ type: "omnix-open-settings", bridgeToken }),
    bridgeToken
  )?.type,
  "omnix-open-settings"
);
assert.equal(nativeBridgeMessage("not-json", bridgeToken), null);
const request_id = "caafcc01-78d1-4d98-a643-aed26eca10c4";
const articleMessage = {
  type: "omnix-open-article",
  request_id,
  bridgeToken,
  url: "https://publisher.example.test/story",
  title: "A headline"
};
assert.equal(
  nativeBridgeMessage(
    JSON.stringify({ ...articleMessage, url: bbc + "?utm_source=rss#watch" }),
    bridgeToken
  )?.url,
  bbc + ".app?utm_source=rss#watch"
);
assert.equal(
  nativeBridgeMessage(JSON.stringify(articleMessage), bridgeToken)?.url,
  articleMessage.url
);
for (const patch of [
  { url: "javascript:alert(1)" },
  { url: "https://user:secret@publisher.example.test" },
  { request_id: "bad" },
  { title: "x".repeat(251) },
  { bridgeToken: "forged" }
])
  assert.equal(
    nativeBridgeMessage(
      JSON.stringify({ ...articleMessage, ...patch }),
      bridgeToken
    ),
    null
  );
const content =
  '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk/></gpx>';
assert.equal(
  nativeBridgeMessage(
    JSON.stringify({
      type: "omnix-export-gpx",
      request_id,
      content,
      bridgeToken
    }),
    bridgeToken
  )?.content,
  content
);
for (const patch of [
  { content: "<html>wrong</html>" },
  {
    content: '<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///private">]>' + content
  },
  { request_id: "wrong" },
  { content: "x".repeat(2100001) },
  { bridgeToken: "forged" }
])
  assert.equal(
    nativeBridgeMessage(
      JSON.stringify({
        type: "omnix-export-gpx",
        request_id,
        content,
        bridgeToken,
        ...patch
      }),
      bridgeToken
    ),
    null
  );
assert.equal(
  nativeBridgeMessage(
    JSON.stringify({
      type: "omnix-health",
      request_id,
      bridgeToken,
      action: "read",
      metrics: ["steps", "sleep"]
    }),
    bridgeToken
  )?.action,
  "read"
);
for (const patch of [
  { action: "write" },
  { metrics: ["medical_records"] },
  { changes_token: "x".repeat(10001) },
  { bridgeToken: "forged" }
])
  assert.equal(
    nativeBridgeMessage(
      JSON.stringify({
        type: "omnix-health",
        request_id,
        bridgeToken,
        action: "read",
        ...patch
      }),
      bridgeToken
    ),
    null
  );
