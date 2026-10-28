import { useEffect, useState } from "react";

export function useStoredWidth(
  key: string,
  fallback: number,
  min: number,
  max: number
) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw === null ? fallback : Number(raw);
      return Number.isFinite(parsed)
        ? Math.max(min, Math.min(max, parsed))
        : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      /* Layout preferences are optional. */
    }
  }, [key, value]);
  return [
    value,
    (next: number) => setValue(Math.max(min, Math.min(max, next)))
  ] as const;
}

export function useStoredFlag(key: string, fallback = false) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : raw === "true";
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      /* Layout preferences are optional. */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
