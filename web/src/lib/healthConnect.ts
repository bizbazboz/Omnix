import { useEffect } from "react";
import { api, qc, type User } from "./api";
import { nativeRequest } from "./native";
export const phoneMetrics = [
  ["steps", "Steps"],
  ["distance", "Kilometres"],
  ["weight", "Weight"],
  ["calories", "Calories burned"],
  ["workout_minutes", "Workout time"],
  ["sleep", "Sleep"],
  ["active_energy", "Active calories"],
  ["heart_rate", "Average heart rate"],
  ["oxygen", "Blood oxygen"],
  ["systolic", "Systolic pressure"],
  ["diastolic", "Diastolic pressure"],
  ["glucose", "Blood glucose"],
  ["body_fat", "Body fat"],
  ["bmr", "Basal metabolic rate"],
  ["height", "Height"],
  ["vo2_max", "VO₂ max"],
  ["power", "Average power"],
  ["speed", "Average speed"],
  ["calories_in", "Food energy"],
  ["protein", "Protein"],
  ["carbs", "Carbohydrates"],
  ["fat", "Fat"],
  ["fibre", "Fibre"],
  ["sugar", "Sugar"],
  ["sodium", "Sodium"]
] as const;
export type PhoneConfig = {
  user_id: string;
  revision: number;
  enabled: boolean;
  preferred?: boolean;
  device_id?: string;
  metrics: string[];
  permissions: string[];
  timezone?: string;
  last_sync?: string;
  captured_at?: string;
  changes_token?: string;
};
export type PhoneStatus = {
  available: boolean;
  status: number;
  permissions: string[];
  device_id?: string;
  platform: string;
  supported_metrics?: string[];
  timezone?: string;
};
export const phoneStatus = () =>
  nativeRequest<PhoneStatus>("omnix-health", { action: "status" });
export const phoneCommand = <T>(
  action: string,
  values: Record<string, unknown> = {}
) => nativeRequest<T>("omnix-health", { action, ...values });
const running = new Set<string>();
const configuring = new Set<string>();
export async function withPhoneHealthSettings<T>(
  id: string,
  action: () => Promise<T>
): Promise<T> {
  configuring.add(id);
  try {
    return await action();
  } finally {
    configuring.delete(id);
  }
}
const ownerIs = (id: string) => qc.getQueryData<User>(["me"])?.id === id;
export async function syncPhoneHealth(userId: string, force = true) {
  if (running.has(userId)) throw Error("A phone sync is already running.");
  if (!ownerIs(userId)) throw Error("Sign in before syncing phone health.");
  running.add(userId);
  try {
    let config = await api<PhoneConfig>("/health/connect");
    if (config.user_id !== userId || !config.enabled)
      throw Error("Enable phone health in Integrations first.");
    const device = await phoneStatus();
    if (!device.available || device.device_id !== config.device_id)
      throw Error(
        "This phone is not the active Health Connect source. Connect it in Integrations."
      );
    if (!ownerIs(userId)) throw Error("The signed-in account changed.");
    if (device.timezone && device.timezone !== config.timezone)
      config = await api<PhoneConfig>("/health/connect", {
        method: "PUT",
        body: JSON.stringify({
          expected_revision: config.revision,
          enabled: true,
          preferred: config.preferred ?? true,
          device_id: device.device_id,
          metrics: config.metrics,
          timezone: device.timezone
        })
      });
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: config.timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    const lastDay = config.captured_at
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone: config.timezone || "UTC",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).format(new Date(config.captured_at))
      : "";
    const permissions = device.permissions
      .filter((p) => config.metrics.includes(p))
      .sort()
      .join(",");
    const read = await phoneCommand<{
      unchanged: boolean;
      permissions: string[];
      points: Record<string, Record<string, number>>;
      dates: string[];
      timezone: string;
      captured_at: string;
      changes_token: string;
    }>("read", {
      metrics: config.metrics,
      timezone: config.timezone,
      changes_token:
        permissions === [...(config.permissions ?? [])].sort().join(",")
          ? config.changes_token || ""
          : "",
      force:
        force ||
        today !== lastDay ||
        permissions !== [...(config.permissions ?? [])].sort().join(",")
    });
    if (!ownerIs(userId))
      throw Error("The signed-in account changed. No phone data was uploaded.");
    if (!read.unchanged) {
      const { unchanged: _, ...snapshot } = read;
      await api("/health/connect/sync", {
        method: "POST",
        body: JSON.stringify({
          ...snapshot,
          device_id: device.device_id,
          expected_revision: config.revision,
          batch_id: crypto.randomUUID()
        })
      });
    }
    for (const key of ["phone-health", "health-status", "health-statistics"])
      void qc.invalidateQueries({ queryKey: [key] });
    return read.permissions.length
      ? "Phone readings synced."
      : "Health permissions are off. Saved history is retained; no denied readings were accessed.";
  } finally {
    running.delete(userId);
  }
}
export function useCompanionHealth(userId: string) {
  useEffect(() => {
    if (!window.ReactNativeWebView) return;
    let active = true;
    const sync = () => {
      if (
        active &&
        !configuring.has(userId) &&
        document.visibilityState === "visible" &&
        window.omnixNativeSend
      )
        void api<PhoneConfig>("/health/connect")
          .then((config) => {
            if (active && config.enabled) return syncPhoneHealth(userId, false);
          })
          .catch(() => {
            /* Manual sync exposes actionable errors; retry on foreground. */
          });
    };
    const timer = setInterval(sync, 300000);
    window.addEventListener("omnix-native-ready", sync);
    window.addEventListener("omnix-foreground", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("omnix-native-ready", sync);
      window.removeEventListener("omnix-foreground", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [userId]);
}
