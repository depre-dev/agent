import { ConflictError } from "../core/errors.js";

export class RecurringSchedulerService {
  constructor(platformService, eventBus = undefined, { enabled = false, logger = console } = {}) {
    this.platformService = platformService;
    this.eventBus = eventBus;
    this.enabled = enabled;
    this.logger = logger;
    this.runtime = new Map();
    this.timer = undefined;
    this.running = false;
  }

  start() {
    if (!this.enabled || this.running) {
      return;
    }
    this.running = true;
    void this.scheduleNextTick();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  async getStatus(now = new Date()) {
    const recurring = this.platformService.getRecurringTemplateStatus();
    return {
      enabled: this.enabled,
      running: this.running,
      templates: recurring.templates.map((template) => {
        const runtime = {
          paused: template.paused,
          lastFiredAt: template.lastFiredAt,
          nextFireAt: template.nextFireAt,
          lastResult: template.lastResult,
          ...(this.runtime.get(template.templateId) ?? {})
        };
        const nextFireAt = runtime.nextFireAt ?? computeNextFireAt(template.schedule, now)?.toISOString();
        return {
          templateId: template.templateId,
          paused: Boolean(runtime.paused),
          lastFiredAt: runtime.lastFiredAt ?? template.lastFiredAt,
          nextFireAt,
          lastResult: runtime.lastResult
        };
      })
    };
  }

  async pauseTemplate(templateId) {
    const current = this.runtime.get(templateId) ?? {};
    this.runtime.set(templateId, { ...current, paused: true });
    this.platformService.pauseRecurringTemplate?.(templateId);
  }

  async resumeTemplate(templateId) {
    const current = this.runtime.get(templateId) ?? {};
    this.runtime.set(templateId, { ...current, paused: false });
    this.platformService.resumeRecurringTemplate?.(templateId);
    if (this.running) {
      void this.scheduleNextTick();
    }
  }

  async runDueTemplates(now = new Date()) {
    const recurring = this.platformService.getRecurringTemplateStatus();
    const fired = [];
    for (const template of recurring.templates) {
      const runtime = this.runtime.get(template.templateId) ?? {};
      if (runtime.paused) {
        continue;
      }
      const nextFireAt = runtime.nextFireAt
        ? new Date(runtime.nextFireAt)
        : computeNextFireAt(template.schedule, now, runtime.lastFiredAt);
      if (!nextFireAt) {
        this.runtime.set(template.templateId, {
          ...runtime,
          lastResult: { status: "invalid_schedule", at: now.toISOString() }
        });
        continue;
      }
      if (nextFireAt.getTime() > now.getTime()) {
        this.runtime.set(template.templateId, {
          ...runtime,
          nextFireAt: nextFireAt.toISOString()
        });
        continue;
      }

      try {
        const derivative = this.platformService.fireRecurringJob(template.templateId, { firedAt: now });
        const upcoming = computeNextFireAt(template.schedule, new Date(now.getTime() + 60_000), now.toISOString());
        this.runtime.set(template.templateId, {
          ...runtime,
          lastFiredAt: now.toISOString(),
          nextFireAt: upcoming?.toISOString(),
          lastResult: {
            status: "fired",
            at: now.toISOString(),
            derivativeId: derivative.id
          }
        });
        this.platformService.jobCatalogService?.updateRecurringTemplateRuntime?.(template.templateId, {
          lastFiredAt: now.toISOString(),
          nextFireAt: upcoming?.toISOString(),
          lastResult: {
            status: "fired",
            at: now.toISOString(),
            derivativeId: derivative.id
          }
        });
        this.eventBus?.publish({
          id: `platform-recurring-fired-${template.templateId}-${Date.now()}`,
          topic: "recurring.fired",
          jobId: derivative.id,
          timestamp: now.toISOString(),
          data: {
            templateId: template.templateId,
            derivativeId: derivative.id,
            firedAt: now.toISOString()
          }
        });
        fired.push(derivative);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = error instanceof ConflictError ? "conflict" : "failed";
        this.runtime.set(template.templateId, {
          ...runtime,
          nextFireAt: computeNextFireAt(template.schedule, new Date(now.getTime() + 60_000), runtime.lastFiredAt)?.toISOString(),
          lastResult: {
            status,
            at: now.toISOString(),
            message
          }
        });
        this.platformService.jobCatalogService?.updateRecurringTemplateRuntime?.(template.templateId, {
          nextFireAt: computeNextFireAt(template.schedule, new Date(now.getTime() + 60_000), runtime.lastFiredAt)?.toISOString(),
          lastResult: {
            status,
            at: now.toISOString(),
            message
          }
        });
        this.logger.warn?.({ templateId: template.templateId, err: error }, "recurring_scheduler.fire_failed");
      }
    }
    return fired;
  }

  async scheduleNextTick(now = new Date()) {
    if (!this.enabled || !this.running) {
      return;
    }
    await this.runDueTemplates(now);
    if (!this.running) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.scheduleNextTick(new Date());
    }, 60_000);
  }
}

export function computeNextFireAt(schedule, now = new Date(), lastFiredAt = undefined) {
  if (!schedule?.cron) {
    return undefined;
  }
  const [minuteField, hourField, dayField, monthField, weekdayField] = String(schedule.cron).trim().split(/\s+/u);
  if (!minuteField || !hourField || !dayField || !monthField || !weekdayField) {
    return undefined;
  }
  const start = new Date(now);
  start.setSeconds(0, 0);
  const from = lastFiredAt ? new Date(Math.max(start.getTime(), new Date(lastFiredAt).getTime() + 60_000)) : start;
  const limit = new Date(from.getTime() + (366 * 24 * 60 * 60 * 1000));
  const candidate = new Date(from);
  while (candidate <= limit) {
    if (
      fieldMatches(minuteField, candidate.getUTCMinutes()) &&
      fieldMatches(hourField, candidate.getUTCHours()) &&
      fieldMatches(dayField, candidate.getUTCDate()) &&
      fieldMatches(monthField, candidate.getUTCMonth() + 1) &&
      fieldMatches(weekdayField, candidate.getUTCDay())
    ) {
      return candidate;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1, 0, 0);
  }
  return undefined;
}

function fieldMatches(field, value) {
  if (field === "*") {
    return true;
  }
  return Number(field) === value;
}
