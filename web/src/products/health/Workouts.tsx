import { type Metric, format, dayLabel } from "./api";
export default function Workouts({
  metric,
  dates,
  zone
}: {
  metric?: Metric;
  dates: string[];
  zone?: string;
}) {
  const records = (metric?.records || [])
    .filter((record) => dates.includes(record.day))
    .sort((a, b) => (b.start || b.day).localeCompare(a.start || a.day));
  return (
    <section className="health-workouts" aria-label="Recorded workouts">
      <div className="section-title">
        <h2>Sessions</h2>
        <span className="eyebrow">
          {metric?.stale ? "SAVED · STALE" : records.length + " RECORDED"}
        </span>
      </div>
      {records.length ? (
        records.map((record, index) => (
          <details
            className="workout-session"
            key={(record.start || record.day) + index}
          >
            <summary>
              <span className="workout-date">
                {dayLabel(record.day)}
                {record.start && (
                  <small>
                    {new Date(record.start).toLocaleTimeString("en-GB", {
                      timeZone: zone,
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </small>
                )}
              </span>
              <strong>{record.name}</strong>
              <span>
                {format(record.minutes ?? undefined, "workout_minutes")}{" "}
                <small>min</small>
              </span>
            </summary>
            <dl className="workout-details">
              {[
                {
                  label: "Active time",
                  value: record.minutes,
                  unit: "min",
                  id: "workout_minutes"
                },
                {
                  label: "Distance",
                  value: record.distance,
                  unit: "km",
                  id: "distance"
                },
                {
                  label: "Energy",
                  value: record.calories,
                  unit: "kcal",
                  id: "calories"
                },
                {
                  label: "Average heart rate",
                  value: record.heart_rate,
                  unit: "bpm",
                  id: "heart_rate"
                },
                {
                  label: "Steps",
                  value: record.steps,
                  unit: "steps",
                  id: "steps"
                }
              ].map((item) => (
                <div key={item.id}>
                  <dt>{item.label}</dt>
                  <dd>
                    {format(item.value ?? undefined, item.id)}{" "}
                    <small>{item.unit}</small>
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        ))
      ) : (
        <p className="muted">
          {metric?.status === "not_shared"
            ? "Activity permission has not been shared. Manage access in Integrations."
            : metric?.status === "error"
              ? "Workouts could not refresh. Try again later."
              : "No workouts recorded in this date range."}
        </p>
      )}
    </section>
  );
}
