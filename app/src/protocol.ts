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
export function firebaseClientForPackage(input: unknown, packageName: string) {
  const clients =
    input && typeof input === "object" && "clients" in input
      ? input.clients
      : null;
  if (!Array.isArray(clients))
    throw new Error(
      "This instance has no Android Firebase configuration. Check Integrations."
    );
  const matching = clients.filter(
    (c) => c && typeof c === "object" && c.packageName === packageName
  );
  if (matching.length !== 1)
    throw new Error(
      "Upload the Firebase Android configuration matching this companion package in Integrations."
    );
  const c = matching[0];
  if (
    typeof c.messagingSenderId !== "string" ||
    !/^[0-9]{6,30}$/.test(c.messagingSenderId) ||
    typeof c.appId !== "string" ||
    !new RegExp("^1:" + c.messagingSenderId + ":android:[a-fA-F0-9]+$").test(
      c.appId
    ) ||
    typeof c.apiKey !== "string" ||
    !/^AIza[A-Za-z0-9_-]{35}$/.test(c.apiKey) ||
    typeof c.projectId !== "string" ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(c.projectId)
  )
    throw new Error(
      "Invalid Firebase client configuration from this instance."
    );
  return {
    projectId: c.projectId as string,
    appId: c.appId as string,
    apiKey: c.apiKey as string,
    messagingSenderId: c.messagingSenderId as string,
    packageName
  };
}

export function notificationNavigation(
  data: unknown,
  origin: string
): string | undefined {
  try {
    if (!data || typeof data !== "object") return;
    const value = data as { origin?: unknown; href?: unknown };
    if (value.origin !== origin || typeof value.href !== "string") return;
    const url = new URL(value.href, origin);
    if (
      internalNavigation(url.href, origin) &&
      /^\/(email|daily|settings)(\/|$)/.test(url.pathname)
    )
      return url.href;
  } catch {
    /* Malformed notifications must not crash the app. */
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

// Only workspace URLs may become WebView entry points; OIDC callbacks stay in the browser.
export function appLinkNavigation(input: string): string | null {
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "omnix.bizbazboz.uk" ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    if (
      !/^\/(?:$|(?:email|calendar|health|notes|daily|iot|settings|onboarding)(?:\/|$))/.test(
        url.pathname
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function nativeBridgeBootstrap(token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error("Invalid bridge capability");
  return `if(window.top===window && !window.omnixNativeSend && window.ReactNativeWebView){
    const send=window.ReactNativeWebView.postMessage.bind(window.ReactNativeWebView);
    Object.defineProperty(window,'omnixNativeSend',{value:(message)=>send(JSON.stringify({...message,bridgeToken:${JSON.stringify(token)}})),writable:false,configurable:false});
    window.dispatchEvent(new Event('omnix-native-ready'));
  }true;`;
}
export function nativeBridgeMessage(
  raw: string,
  token: string
): { type: string; silent?: boolean; firebase?: unknown } | null {
  try {
    if (raw.length > 200000) return null;
    const value = JSON.parse(raw);
    if (
      !value ||
      value.bridgeToken !== token ||
      ![
        "omnix-push-register",
        "omnix-app-info",
        "omnix-open-settings"
      ].includes(value.type)
    )
      return null;
    return {
      type: value.type,
      silent: Boolean(value.silent),
      firebase: value.firebase
    };
  } catch {
    return null;
  }
}
