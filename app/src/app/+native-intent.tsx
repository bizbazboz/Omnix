// Keep the WebView mounted while native QR/auth listeners process incoming links.
// The callback never carries authentication credentials.
export function redirectSystemPath() {
  return "/";
}
