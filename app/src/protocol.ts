export const AUTH_SCHEME =
  process.env.EXPO_PUBLIC_OMNIX_CHANNEL === "production"
    ? "omnix"
    : "omnix-preview";
export const AUTH_RETURN = AUTH_SCHEME + "://paired";
export function mobileGrant(input: string, request: string): string {
  const url = new URL(input);
  const code = url.searchParams.get("code") || "";
  if (
    url.protocol !== AUTH_SCHEME + ":" ||
    url.hostname !== "paired" ||
    !["", "/"].includes(url.pathname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.searchParams.getAll("request").length !== 1 ||
    url.searchParams.get("request") !== request ||
    url.searchParams.getAll("code").length !== 1 ||
    !/^[A-Za-z0-9_-]{54}$/.test(code)
  )
    throw new Error("Unexpected sign-in callback. Start again in this app.");
  return code;
}
export function instanceOrigin(input: string): string {
  const url = new URL(input.trim());
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    !["", "/"].includes(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Enter an HTTPS instance address without a path or sign-in token."
    );
  return url.origin;
}
export function pairingOrigin(input: string): string {
  const url = new URL(input);
  if (
    !["omnix:", "omnix-preview:"].includes(url.protocol) ||
    url.hostname !== "pair" ||
    !["", "/"].includes(url.pathname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.searchParams.getAll("origin").length !== 1
  )
    throw new Error("This is not an Omnix pairing code.");
  return instanceOrigin(url.searchParams.get("origin") || "");
}
export function internalNavigation(input: string, origin: string): boolean {
  try {
    return (
      new URL(input).origin === origin && new URL(input).protocol === "https:"
    );
  } catch {
    return false;
  }
}
export function loginNavigation(input: string, origin: string): boolean {
  try {
    return (
      internalNavigation(input, origin) &&
      new URL(input).pathname === "/api/v1/auth/login"
    );
  } catch {
    return false;
  }
}
export function base64url(bytes: Uint8Array): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "",
    value = 0,
    bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      output += chars[(value >>> bits) & 63];
    }
  }
  if (bits) output += chars[(value << (6 - bits)) & 63];
  return output;
}
