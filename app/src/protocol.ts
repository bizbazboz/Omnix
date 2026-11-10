export const AUTH_RETURN = "omnix://paired";
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
    url.protocol !== "omnix:" ||
    url.hostname !== "pair" ||
    url.pathname ||
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
