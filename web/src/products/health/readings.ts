import type { Metric } from "./api";

export function weekStart(day: string) {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
export function weeklyHours(metric: Metric | undefined, day: string) {
  const start = weekStart(day),
    end = new Date(start + "T12:00:00Z");
  end.setUTCDate(end.getUTCDate() + 6);
  const values = Object.entries(metric?.points || {})
    .filter(([date]) => date >= start && date <= end.toISOString().slice(0, 10))
    .map(([, value]) => value);
  return values.length
    ? values.reduce((sum, value) => sum + value, 0)
    : undefined;
}
export function latestDay(metric: Metric | undefined, day: string) {
  return Object.keys(metric?.points || {})
    .filter((date) => date <= day)
    .sort()
    .at(-1);
}
