import { calculateSla, isReportableRequest, requestLocalDate } from "./sla.js";

function holidayToIso(value) {
  const [day, month, year] = value.split("/");
  return `${year}-${month}-${day}`;
}

export class SyncService {
  constructor({
    client,
    repository,
    intervalMs = 30_000,
    logger = console,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }) {
    this.client = client;
    this.repository = repository;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.sleep = sleep;
    this.ready = false;
    this.running = false;
    this.timer = null;
  }

  isReady() {
    return this.ready;
  }

  start() {
    return this.syncOnce()
      .catch(() => this.logger.error("Helpdesk sync failed; will retry"))
      .finally(() => this.schedule());
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  schedule() {
    this.stop();
    this.timer = setTimeout(() => this.start(), this.intervalMs);
  }

  async syncOnce() {
    if (this.running) return;
    this.running = true;
    try {
      await this.syncMetadata();
      await this.syncChanges();
      this.ready = true;
    } finally {
      this.running = false;
    }
  }

  async syncMetadata() {
    const sites = (await this.getWithRetry("/v1/sites")).data;
    for (const site of sites) {
      this.repository.upsertSite(site);
      const holidays = (await this.getWithRetry(`/v1/sites/${site.id}/holidays`)).data;
      this.repository.replaceHolidays(site.id, holidays.map((holiday) => holidayToIso(holiday.date)));
    }
    const staff = (await this.getWithRetry("/v1/staff")).data;
    for (const member of staff) {
      this.repository.upsertStaff(member);
      this.repository.updateResponderName(member);
    }
  }

  async syncChanges() {
    let cursor = this.repository.getSyncCursor();
    for (;;) {
      let response;
      try {
        response = await this.getWithRetry("/v1/changes", cursor ? { cursor, limit: "500" } : { limit: "500" });
      } catch (error) {
        if (error.status !== 410) throw error;
        cursor = null;
        this.repository.setSyncCursor(null);
        continue;
      }
      const changedRequestIds = new Set();
      for (const change of response.data) this.applyChange(change, changedRequestIds);
      for (const requestId of changedRequestIds) this.refreshRequest(requestId);
      cursor = response.next_cursor;
      this.repository.setSyncCursor(cursor);
      if (!response.has_more) return;
    }
  }

  applyChange(change, changedRequestIds = new Set()) {
    if ((change.type === "request.created" || change.type === "request.updated") && change.request) {
      this.repository.upsertRequest(change.request);
      changedRequestIds.add(change.request.id);
      return;
    }
    if (change.type === "event.created" && change.event) {
      this.repository.upsertEvent(change.request_id, change.event);
      changedRequestIds.add(change.request_id);
      return;
    }
    if (change.type === "staff.updated" && change.staff) {
      this.repository.upsertStaff(change.staff);
    }
  }

  async getWithRetry(pathname, params = {}) {
    let attempts = 0;
    for (;;) {
      try {
        return await this.client.get(pathname, params);
      } catch (error) {
        const temporaryFailure = error.status === 429 || (error.status >= 500 && error.status < 600);
        if (!temporaryFailure) throw error;
        const delaySeconds = error.retryAfterSeconds ?? Math.min(2 ** attempts, 30);
        attempts += 1;
        await this.sleep(delaySeconds * 1000);
      }
    }
  }

  refreshRequest(requestId) {
    const request = this.repository.getRequest(requestId);
    if (!request) return;
    if (!isReportableRequest(request)) {
      this.repository.deleteSlaRow(requestId);
      return;
    }
    const site = this.repository.getSite(request.site_id);
    if (!site) return;
    const metrics = calculateSla({
      request,
      events: this.repository.getEventsForRequest(requestId),
      site,
      holidays: this.repository.getHolidayDates(site.id),
      staffById: this.repository.getStaffById(),
    });
    this.repository.upsertSlaRow(request, requestLocalDate(request, site), metrics);
  }
}
