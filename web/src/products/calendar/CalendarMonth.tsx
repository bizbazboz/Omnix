import { ChevronLeft, ChevronRight, MapPin, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type CalendarEvent,
  dateKey,
  monthDays,
  eventsOnDay,
  eventTime,
  eventDay,
  dayLabel
} from "./api";

export default function CalendarMonth({
  month,
  onMonth,
  events,
  zone,
  hour12
}: {
  month: Date;
  onMonth: (month: Date) => void;
  events: CalendarEvent[];
  zone: string;
  hour12: boolean;
}) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const [selected, setSelected] = useState(
    today.startsWith(dateKey(month).slice(0, 7)) ? today : dateKey(month)
  );
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (detail) dialog.current?.showModal();
  }, [detail]);
  const days = monthDays(month);
  const offset =
    (month.getFullYear() - new Date().getFullYear()) * 12 +
    month.getMonth() -
    new Date().getMonth();
  const change = (amount: number) =>
    onMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1, 12));
  const selectedEvents = eventsOnDay(events, selected, zone);
  return (
    <div className="month-view">
      <header className="month-toolbar">
        <h2>
          {month.toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric"
          })}
        </h2>
        <div>
          <button
            className="text-button"
            onClick={() => {
              setSelected(today);
              const [year, month] = today.split("-").map(Number);
              onMonth(new Date(year, month - 1, 1, 12));
            }}
          >
            Today
          </button>
          <button
            className="icon-button"
            aria-label="Previous month"
            disabled={offset <= -11}
            onClick={() => change(-1)}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Next month"
            disabled={offset >= 11}
            onClick={() => change(1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </header>
      <div className="month-weekdays" aria-hidden="true">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="month-grid" role="group" aria-label="Month calendar">
        {days.map((date) => {
          const key = dateKey(date),
            items = eventsOnDay(events, key, zone);
          return (
            <div
              key={key}
              className={
                "month-day " +
                (date.getMonth() !== month.getMonth() ? "outside-month " : "") +
                (selected === key ? "selected-day" : "")
              }
            >
              <button
                className={"month-date " + (today === key ? "today" : "")}
                aria-label={dayLabel(key)}
                aria-pressed={selected === key}
                aria-current={today === key ? "date" : undefined}
                onClick={() => setSelected(key)}
              >
                {date.getDate()}
              </button>
              {items.slice(0, 3).map((event) => (
                <button
                  className={"month-event " + (event.all_day ? "all-day" : "")}
                  key={event.id}
                  title={event.title + " · " + event.calendar}
                  onClick={() => {
                    setSelected(key);
                    setDetail(event);
                  }}
                >
                  {!event.all_day && (
                    <time>{eventTime(event, zone, hour12)}</time>
                  )}
                  <span>{event.title}</span>
                </button>
              ))}
              {items.length > 3 && (
                <button className="month-more" onClick={() => setSelected(key)}>
                  +{items.length - 3} more
                </button>
              )}
            </div>
          );
        })}
      </div>
      <section className="selected-day-events" aria-label="Selected day">
        <div className="section-title">
          <h2>{dayLabel(selected)}</h2>
          <span className="eyebrow">{selectedEvents.length} EVENTS</span>
        </div>
        {!selectedEvents.length ? (
          <p className="muted">No events.</p>
        ) : (
          selectedEvents.map((event) => (
            <button
              className="day-event-row"
              key={event.id}
              onClick={() => setDetail(event)}
            >
              <time>{eventTime(event, zone, hour12)}</time>
              <span>
                <strong>{event.title}</strong>
                <small>
                  {event.calendar}
                  {event.location ? " · " + event.location : ""}
                </small>
              </span>
            </button>
          ))
        )}
      </section>
      {detail && (
        <dialog
          className="calendar-modal event-dialog"
          ref={dialog}
          aria-labelledby="event-title"
          onCancel={(event) => {
            event.preventDefault();
            setDetail(null);
          }}
        >
          <div className="section-title">
            <span className="eyebrow">{detail.calendar}</span>
            <button
              className="icon-button"
              aria-label="Close event"
              onClick={() => setDetail(null)}
            >
              <X size={18} />
            </button>
          </div>
          <h2 id="event-title">{detail.title}</h2>
          <p>
            {dayLabel(eventDay(detail, zone))} ·{" "}
            {eventTime(detail, zone, hour12)}
          </p>
          {!detail.all_day && (
            <p className="muted">
              Until{" "}
              {new Date(detail.end).toLocaleString("en-GB", {
                timeZone: zone,
                dateStyle: "medium",
                timeStyle: "short",
                hour12
              })}
            </p>
          )}
          {detail.location && (
            <p className="event-location">
              <MapPin size={14} />
              {detail.location}
            </p>
          )}
          {detail.description && (
            <p className="event-description">{detail.description}</p>
          )}
        </dialog>
      )}
    </div>
  );
}
