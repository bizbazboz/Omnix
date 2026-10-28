import { dayLabel, format } from "./api";

type Props = {
  dates: string[];
  points: Record<string, number>;
  selected: string;
  onSelect?: (day: string) => void;
  metric?: string;
  unit?: string;
  compact?: boolean;
};
export default function HistoryChart({
  dates,
  points,
  selected,
  onSelect,
  metric = "steps",
  unit = "steps",
  compact = false
}: Props) {
  const values = dates
    .map((day) => points[day])
    .filter((value) => value !== undefined);
  const max = Math.max(1, ...values);
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const ceiling = Math.ceil(max / magnitude / 0.5) * magnitude * 0.5;
  const width = 720,
    height = compact ? 90 : 200,
    slot = width / Math.max(1, dates.length);
  const short = (value: number) =>
    value >= 1000
      ? (value / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 }) +
        "k"
      : value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
  return (
    <div className={"history-chart " + (compact ? "compact" : "")}>
      {!compact && (
        <div className="chart-scale" aria-hidden="true">
          {[ceiling, ceiling / 2, 0].map((value) => (
            <span key={value}>{short(value)}</span>
          ))}
        </div>
      )}
      <div className="chart-body">
        <div className="chart-plot">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${metric.replaceAll("_", " ")} over ${dates.length} days${values.length ? "" : ": no readings"}`}
          >
            {[0, 0.5, 1].map((fraction) => (
              <line
                key={fraction}
                x1="0"
                x2={width}
                y1={fraction * (height - 6) + 3}
                y2={fraction * (height - 6) + 3}
                className="chart-grid-line"
              />
            ))}
            {dates.map((day, index) => {
              const value = points[day],
                x = index * slot + slot * 0.18,
                barWidth = slot * 0.64;
              const barHeight =
                value === undefined
                  ? 0
                  : Math.max(2, (value / ceiling) * (height - 10));
              return value === undefined ? (
                <line
                  key={day}
                  x1={x}
                  x2={x + barWidth}
                  y1={height - 3}
                  y2={height - 3}
                  className="chart-missing"
                />
              ) : (
                <rect
                  key={day}
                  x={x}
                  y={height - 3 - barHeight}
                  width={barWidth}
                  height={barHeight}
                  rx={compact ? 1 : 2}
                  className={
                    day === selected ? "chart-bar selected" : "chart-bar"
                  }
                />
              );
            })}
          </svg>
          {onSelect && (
            <div
              className="chart-targets"
              style={{
                gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))`
              }}
            >
              {dates.map((day) => (
                <button
                  key={day}
                  aria-label={`${dayLabel(day)}: ${points[day] === undefined ? "No reading" : format(points[day], metric) + " " + unit}`}
                  title={`${dayLabel(day)} · ${points[day] === undefined ? "No reading" : format(points[day], metric) + " " + unit}`}
                  aria-pressed={day === selected}
                  onClick={() => onSelect(day)}
                  onFocus={() => onSelect(day)}
                />
              ))}
            </div>
          )}
        </div>
        {!compact && (
          <div
            className="chart-dates"
            aria-hidden="true"
            style={{
              gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))`
            }}
          >
            {dates.map((day, index) => (
              <span key={day}>
                {dates.length <= 7
                  ? new Date(day + "T12:00:00").toLocaleDateString("en-GB", {
                      weekday: "short"
                    })
                  : index % 7 === 0 || index === dates.length - 1
                    ? day.slice(8)
                    : ""}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
