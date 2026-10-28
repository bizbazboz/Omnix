export type Feed = {
  id: string;
  label: string;
  host: string;
  status: string;
  error: string;
  last_sync: string | null;
};
export type CalendarEvent = {
  id: string;
  feed_id: string;
  calendar: string;
  title: string;
  location: string;
  start: string;
  end: string;
  all_day: boolean;
  start_ts: number;
  end_ts: number;
  description?: string;
};
export function eventDay(event: CalendarEvent, zone: string) {
  return event.all_day
    ? event.start
    : new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date(event.start));
}
export function eventTime(event: CalendarEvent, zone: string, hour12 = false) {
  return event.all_day
    ? "All day"
    : new Date(event.start).toLocaleTimeString("en-GB", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hour12
      });
}
export function dayLabel(day: string) {
  return new Date(day + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function monthDays(month: Date) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return Array.from(
    { length: 42 },
    (_, i) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12)
  );
}
export function eventsOnDay(
  events: CalendarEvent[],
  day: string,
  zone: string
) {
  return events.filter((event) => {
    const first = eventDay(event, zone);
    let last = first;
    if (event.all_day) {
      const end = new Date(event.end + "T12:00:00");
      end.setDate(end.getDate() - 1);
      last = dateKey(end);
    } else if (new Date(event.end).getTime() > new Date(event.start).getTime())
      last = eventDay(
        {
          ...event,
          start: new Date(new Date(event.end).getTime() - 1).toISOString()
        },
        zone
      );
    if (last < first) last = first;
    return first <= day && day <= last;
  });
}
