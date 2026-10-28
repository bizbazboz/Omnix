export type HealthStatus = {
  configured: boolean;
  can_configure: boolean;
  connected: boolean;
  status: string;
  last_sync: string | null;
  error: string;
  groups: string[];
};
export type Workout = {
  day: string;
  start: string | null;
  end: string | null;
  name: string;
  minutes: number | null;
  distance: number | null;
  calories: number | null;
  heart_rate: number | null;
  steps: number | null;
};
export type Metric = {
  records?: Workout[];
  label: string;
  unit: string;
  group: string;
  status: "ready" | "empty" | "error" | "not_shared";
  points: Record<string, number>;
  stale?: boolean;
  reason?: string;
};
export type Statistics = {
  dates: string[];
  timezone?: string;
  metrics: Record<string, Metric>;
};

export const dayLabel = (day: string) =>
  new Date(day + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short"
  });
export const format = (value: number | undefined, id: string) =>
  value === undefined
    ? "—"
    : value.toLocaleString("en-GB", {
        maximumFractionDigits: [
          "steps",
          "calories",
          "calories_in",
          "active_energy",
          "floors",
          "zone_minutes",
          "workouts",
          "sodium"
        ].includes(id)
          ? 0
          : id === "water"
            ? 2
            : 1
      });
