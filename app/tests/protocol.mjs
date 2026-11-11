import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  AUTH_RETURN,
  instanceOrigin,
  pairingOrigin,
  internalNavigation,
  loginNavigation,
  base64url
} from "../src/protocol.ts";
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
assert.equal(AUTH_RETURN, "omnix://paired");
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
