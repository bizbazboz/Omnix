import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
export const dailyViews = [
  { id: "news", name: "News" },
  { id: "weather", name: "Weather" },
  { id: "transport", name: "Transport" },
  { id: "walks", name: "Walking loops" }
] as const;
export type DailyView = (typeof dailyViews)[number]["id"];
export type Article = {
  id: string;
  source_id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  published: string | null;
};
export type Forecast = {
  source?: string;
  label: string;
  unit: string;
  temperature: number | null;
  feels_like: number | null;
  code: number | null;
  wind: number | null;
  days: {
    date: string;
    high: number | null;
    low: number | null;
    rain: number | null;
    code: number | null;
  }[];
};
export type Line = {
  id: string;
  name: string;
  mode: string;
  statuses: { severity: number; description: string; reason: string }[];
};
export type Walk = {
  coordinates: number[][];
  distance_m: number;
  duration_s: number;
  steps: string[];
  created_at: string;
  requested_km: number;
  attribution: string;
};
type Cached<T> = {
  data: T | null;
  last_sync: string | null;
  enabled: boolean;
  error: string;
};
export type DailyData = {
  widgets: DailyView[];
  configured: boolean;
  walks_configured: boolean;
  walks: Walk | null;
  news: Cached<{
    feeds: { id: string; name: string; items: Article[]; error: string }[];
  }>;
  weather: Cached<Forecast>;
  transport: Cached<{
    lines: Line[];
    available_lines: { id: string; name: string }[];
    attribution: string;
  }>;
};
export function useDaily(summary = false) {
  return useQuery<DailyData>({
    queryKey: ["daily", summary],
    queryFn: () => api("/daily" + (summary ? "?summary=true" : "")),
    staleTime: 15000,
    refetchInterval: 30000
  });
}
export function articles(data?: DailyData) {
  const unique = new Map<string, Article>();
  for (const feed of data?.news.data?.feeds || [])
    for (const item of feed.items)
      if (!unique.has(item.url)) unique.set(item.url, item);
  return [...unique.values()].sort((a, b) =>
    (b.published || "").localeCompare(a.published || "")
  );
}
export function weatherLabel(code: number | null | undefined) {
  if (code === 0) return "Clear";
  if (code !== null && code !== undefined && code <= 3) return "Cloudy";
  if ([45, 48].includes(code!)) return "Fog";
  if ([71, 73, 75, 77, 85, 86].includes(code!)) return "Snow";
  if ([95, 96, 99].includes(code!)) return "Thunderstorms";
  return code === null || code === undefined ? "No reading" : "Rain";
}
export const number = (value: number | null | undefined, suffix = "") =>
  value == null ? "—" : `${Math.round(value)}${suffix}`;
export const lineStatus = (line: Line) =>
  [...line.statuses].sort(
    (a, b) =>
      Number(a.severity === 10) - Number(b.severity === 10) ||
      a.severity - b.severity
  )[0];
