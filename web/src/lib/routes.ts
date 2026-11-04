// Canonical public routes. Legacy links remain readable without exposing their prefix.
export function canonicalWorkspaceUrl(value: string): string {
  const clean = (path: string) =>
    /^\/app(?:\/|$)/.test(path)
      ? "/" + path.slice(4).replace(/^[\/\\]+/, "")
      : path;
  if (value.startsWith("/") && !value.startsWith("//")) {
    const match = value.match(/^([^?#]*)(.*)$/)!;
    return clean(match[1]) + match[2];
  }
  try {
    const url = new URL(value, window.location.origin);
    if (
      url.origin === window.location.origin &&
      clean(url.pathname) !== url.pathname
    )
      return clean(url.pathname) + url.search + url.hash;
  } catch {
    /* Invalid input is handled by the link editor. */
  }
  return value;
}
export function isWorkspaceHref(value: string) {
  return /^\/(?:email|calendar|health|notes|settings|onboarding)(?:[/?#]|$)/.test(
    value
  );
}

export function signInUrl(
  destination = window.location.pathname +
    window.location.search +
    window.location.hash
) {
  return (
    "/api/v1/auth/login?" +
    new URLSearchParams({
      return_to: canonicalWorkspaceUrl(destination)
    }).toString()
  );
}
