import { DateTime } from "luxon";

const weekdayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const targetMinutes = { High: 60, Medium: 240, Low: 480 };

function asLocal(iso, timezone) {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(timezone);
}

export function requestLocalDate(request, site) {
  return asLocal(request.created_at, site.timezone).toISODate();
}

function activeEvents(events) {
  const undoneIds = new Set();
  for (const event of events) {
    if (event.reverts_id !== null && event.reverts_id !== undefined) {
      undoneIds.add(event.id);
      undoneIds.add(event.reverts_id);
    }
  }
  return events.filter((event) => !undoneIds.has(event.id));
}

function chronological(events) {
  return [...events].sort((left, right) => left.at - right.at || left.id - right.id);
}

export function isReportableRequest(request) {
  return request.status !== "canceled" && request.deleted_at === null && request.merged_into_id === null;
}

export function businessMinutesBetween(startIso, endIso, site, holidays) {
  const start = asLocal(startIso, site.timezone);
  const end = asLocal(endIso, site.timezone);
  if (!start.isValid || !end.isValid || end <= start) return 0;

  let seconds = 0;
  let day = start.startOf("day");
  const finalDay = end.startOf("day");
  while (day <= finalDay) {
    const date = day.toISODate();
    const hours = site.business_hours[weekdayKeys[day.weekday % 7]];
    if (hours && !holidays.has(date)) {
      const opens = DateTime.fromFormat(`${date} ${hours.open}`, "yyyy-MM-dd HH:mm", { zone: site.timezone });
      const closes = DateTime.fromFormat(`${date} ${hours.close}`, "yyyy-MM-dd HH:mm", { zone: site.timezone });
      const overlapStart = opens > start ? opens : start;
      const overlapEnd = closes < end ? closes : end;
      if (overlapEnd > overlapStart) {
        seconds += overlapEnd.diff(overlapStart, "seconds").seconds;
      }
    }
    day = day.plus({ days: 1 });
  }
  return Math.floor(seconds / 60);
}

function parseDeadline(dueAt, timezone) {
  const local = DateTime.fromFormat(dueAt, "dd/MM/yyyy HH:mm", { zone: timezone });
  return local.isValid ? local.toSeconds() : null;
}

export function calculateSla({ request, events, site, holidays, staffById }) {
  const eventsInOrder = chronological(activeEvents(events));
  const firstResponse = eventsInOrder.find(
    (event) => event.status === "processing" && event.actor_id !== null && event.actor_id !== undefined,
  );
  const lastComplete = eventsInOrder.filter((event) => event.status === "complete").at(-1);
  const latestDueEvent = eventsInOrder.filter((event) => event.due_at).at(-1);
  const deadline = latestDueEvent ? parseDeadline(latestDueEvent.due_at, site.timezone) : null;

  const response = firstResponse
    ? businessMinutesBetween(request.created_at, new Date(firstResponse.at * 1000).toISOString(), site, holidays)
    : null;
  const target = targetMinutes[request.priority] ?? targetMinutes.Low;

  return {
    responder_id: firstResponse?.actor_id ?? null,
    responder: firstResponse ? staffById.get(firstResponse.actor_id)?.name ?? null : null,
    response_business_minutes: response,
    within_target: response === null ? null : response <= target,
    completed_late: !lastComplete || deadline === null ? null : lastComplete.at > deadline,
  };
}
