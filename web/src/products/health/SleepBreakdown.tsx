import { type Metric, format } from "./api";
const stages = [
  { id: "sleep_deep", label: "Deep" },
  { id: "sleep_light", label: "Light" },
  { id: "sleep_rem", label: "REM" },
  { id: "sleep_awake", label: "Awake" },
  { id: "sleep_restless", label: "Restless" }
];
export default function SleepBreakdown({
  metrics,
  day,
  stale
}: {
  metrics: Record<string, Metric>;
  day: string;
  stale: boolean;
}) {
  const recorded = stages.filter(
    (stage) => metrics[stage.id]?.points[day] !== undefined
  );
  const total = recorded.reduce(
    (sum, stage) => sum + metrics[stage.id].points[day],
    0
  );
  return (
    <section className="sleep-breakdown" aria-label="Recorded sleep stages">
      <div className="section-title">
        <h2>Sleep stages</h2>
        <span className="eyebrow">
          {stale || stages.some((stage) => metrics[stage.id]?.stale)
            ? "SAVED · STALE"
            : "RECORDED SUMMARY"}
        </span>
      </div>
      {recorded.length ? (
        <>
          <div className="sleep-stage-track" aria-hidden="true">
            {recorded.map((stage) => (
              <span
                key={stage.id}
                className={stage.id}
                style={{
                  flexGrow: total ? metrics[stage.id].points[day] / total : 0
                }}
              />
            ))}
          </div>
          <div className="sleep-stage-legend">
            {stages.map((stage) => (
              <div key={stage.id}>
                <span>
                  <i className={stage.id} />
                  {stage.label}
                </span>
                <strong>
                  {format(metrics[stage.id]?.points[day], stage.id)}{" "}
                  <small>h</small>
                </strong>
              </div>
            ))}
          </div>
          <p className="muted">
            Recorded stage durations across sleep sessions and naps. Some
            devices provide duration without stages.
          </p>
        </>
      ) : (
        <p className="muted">No stage breakdown recorded for this day.</p>
      )}
    </section>
  );
}
