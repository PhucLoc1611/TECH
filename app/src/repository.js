import { createDatabase } from "./database.js";
import path from "node:path";

function payloadOf(record) {
  return JSON.stringify(record);
}

function parsePayload(row) {
  return row ? JSON.parse(row.payload) : null;
}

export function defaultDatabasePath(configuredPath = process.env.DATABASE_PATH) {
  return configuredPath || path.join(process.cwd(), "data", "sla-report.db");
}

export function createRepository(filename = defaultDatabasePath()) {
  const database = createDatabase(filename);
  const statements = {
    upsertRequest: database.prepare(`
      INSERT INTO requests (id, site_id, status, priority, created_at, deleted_at, merged_into_id, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        site_id = excluded.site_id, status = excluded.status, priority = excluded.priority,
        created_at = excluded.created_at, deleted_at = excluded.deleted_at,
        merged_into_id = excluded.merged_into_id, payload = excluded.payload
    `),
    getRequest: database.prepare("SELECT payload FROM requests WHERE id = ?"),
    upsertEvent: database.prepare(`
      INSERT INTO events (id, request_id, at, status, actor_id, reverts_id, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        request_id = excluded.request_id, at = excluded.at, status = excluded.status,
        actor_id = excluded.actor_id, reverts_id = excluded.reverts_id, payload = excluded.payload
    `),
    eventsForRequest: database.prepare("SELECT payload FROM events WHERE request_id = ? ORDER BY at ASC, id ASC"),
    getCursor: database.prepare("SELECT value FROM sync_state WHERE key = 'changes_cursor'"),
    setCursor: database.prepare(`
      INSERT INTO sync_state (key, value) VALUES ('changes_cursor', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),
    deleteCursor: database.prepare("DELETE FROM sync_state WHERE key = 'changes_cursor'"),
    upsertSite: database.prepare(`
      INSERT INTO sites (id, timezone, payload) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET timezone = excluded.timezone, payload = excluded.payload
    `),
    getSite: database.prepare("SELECT payload FROM sites WHERE id = ?"),
    getSites: database.prepare("SELECT payload FROM sites ORDER BY id"),
    deleteHolidays: database.prepare("DELETE FROM holidays WHERE site_id = ?"),
    insertHoliday: database.prepare("INSERT INTO holidays (site_id, date) VALUES (?, ?)"),
    holidaysForSite: database.prepare("SELECT date FROM holidays WHERE site_id = ?"),
    upsertStaff: database.prepare(`
      INSERT INTO staff (id, name) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name
    `),
    allStaff: database.prepare("SELECT id, name FROM staff"),
    upsertSlaRow: database.prepare(`
      INSERT INTO sla_rows (request_id, site_id, created_local_date, responder_id, responder, response_business_minutes, within_target, completed_late)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(request_id) DO UPDATE SET
        site_id = excluded.site_id, created_local_date = excluded.created_local_date,
        responder_id = excluded.responder_id, responder = excluded.responder,
        response_business_minutes = excluded.response_business_minutes,
        within_target = excluded.within_target, completed_late = excluded.completed_late
    `),
    getSlaRow: database.prepare(`
      SELECT request_id AS id, site_id, responder_id, responder, response_business_minutes,
        within_target, completed_late FROM sla_rows WHERE request_id = ?
    `),
    deleteSlaRow: database.prepare("DELETE FROM sla_rows WHERE request_id = ?"),
    updateResponderName: database.prepare("UPDATE sla_rows SET responder = ? WHERE responder_id = ?"),
    rowsForRange: database.prepare(`
      SELECT request_id AS id, site_id, responder_id, responder, response_business_minutes,
        within_target, completed_late
      FROM sla_rows
      WHERE created_local_date >= ? AND created_local_date <= ?
        AND (? IS NULL OR site_id = ?)
        AND (? IS NULL OR responder_id = ?)
        AND (? IS NULL OR completed_late = ?)
        AND (? IS NULL OR within_target = ?)
    `),
  };

  return {
    upsertRequest(request) {
      statements.upsertRequest.run(
        request.id,
        request.site_id,
        request.status,
        request.priority,
        request.created_at,
        request.deleted_at,
        request.merged_into_id,
        payloadOf(request),
      );
    },

    getRequest(id) {
      return parsePayload(statements.getRequest.get(id));
    },

    upsertEvent(requestId, event) {
      statements.upsertEvent.run(
        event.id,
        requestId,
        event.at,
        event.status,
        event.actor_id,
        event.reverts_id,
        payloadOf(event),
      );
    },

    getEventsForRequest(requestId) {
      return statements.eventsForRequest.all(requestId).map(parsePayload);
    },

    getSyncCursor() {
      return statements.getCursor.get()?.value ?? null;
    },

    setSyncCursor(cursor) {
      if (cursor === null) {
        statements.deleteCursor.run();
      } else {
        statements.setCursor.run(cursor);
      }
    },

    upsertSite(site) {
      statements.upsertSite.run(site.id, site.timezone, payloadOf(site));
    },

    getSite(id) {
      return parsePayload(statements.getSite.get(id));
    },

    getSites() {
      return statements.getSites.all().map(parsePayload);
    },

    replaceHolidays(siteId, dates) {
      statements.deleteHolidays.run(siteId);
      for (const date of dates) statements.insertHoliday.run(siteId, date);
    },

    getHolidayDates(siteId) {
      return new Set(statements.holidaysForSite.all(siteId).map((row) => row.date));
    },

    upsertStaff(staff) {
      statements.upsertStaff.run(staff.id, staff.name);
    },

    getStaffById() {
      return new Map(statements.allStaff.all().map((staff) => [staff.id, staff]));
    },

    upsertSlaRow(request, createdLocalDate, metrics) {
      statements.upsertSlaRow.run(
        request.id,
        request.site_id,
        createdLocalDate,
        metrics.responder_id,
        metrics.responder,
        metrics.response_business_minutes,
        metrics.within_target === null ? null : Number(metrics.within_target),
        metrics.completed_late === null ? null : Number(metrics.completed_late),
      );
    },

    getSlaRow(requestId) {
      const row = statements.getSlaRow.get(requestId);
      if (!row) return null;
      return {
        ...row,
        within_target: row.within_target === null ? null : Boolean(row.within_target),
        completed_late: row.completed_late === null ? null : Boolean(row.completed_late),
      };
    },

    deleteSlaRow(requestId) {
      statements.deleteSlaRow.run(requestId);
    },

    updateResponderName(staff) {
      statements.updateResponderName.run(staff.name, staff.id);
    },

    findSlaRows({ from, to, siteId = null, responderId = null, late = null, withinTarget = null }) {
      return statements.rowsForRange.all(
        from, to,
        siteId, siteId,
        responderId, responderId,
        late === null ? null : Number(late), late === null ? null : Number(late),
        withinTarget === null ? null : Number(withinTarget), withinTarget === null ? null : Number(withinTarget),
      ).map((row) => ({
        ...row,
        within_target: row.within_target === null ? null : Boolean(row.within_target),
        completed_late: row.completed_late === null ? null : Boolean(row.completed_late),
      }));
    },

    close() {
      database.close();
    },
  };
}
