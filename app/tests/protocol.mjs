import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  AUTH_RETURN,
  appLinkNavigation,
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
