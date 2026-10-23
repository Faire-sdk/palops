import type { DB } from '../../database/db.js';
import type { AuditActor, AuditLog } from '../audit/audit-log.js';
import type { ConsoleService } from '../console/console-service.js';
import type { PalworldService } from '../palworld/index.js';
import { PalworldError } from '../palworld/index.js';
import type { ServerRegistry } from '../servers/server-registry.js';

export interface ScheduleSettings {
  restartEnabled: boolean;
  /** Hours between restarts, counted from restartAt each day. */
  restartEveryHours: number;
  /** First restart of the day, HH:MM in the panel's time zone. */
  restartAt: string;
  /** Players are warned this long before the restart (the game's own shutdown countdown). */
  restartWarnMinutes: number;
  /** Shown to players. Empty means the default; {minutes} is replaced with the warning time. */
  restartMessage: string;
  saveEnabled: boolean;
  saveEveryMinutes: number;
  updatedAt: string | null;
}

export type ScheduleSettingsInput = Omit<ScheduleSettings, 'updatedAt'>;

export interface ScheduleStatus {
  timeZone: string;
  nextRestartAt: string | null;
  nextSaveAt: string | null;
  lastRestartAt: string | null;
  lastSaveAt: string | null;
  lastError: { at: string; message: string } | null;
}

interface Row {
  restart_enabled: number;
  restart_every_hours: number;
  restart_at: string;
  restart_warn_minutes: number;
  restart_message: string;
  save_enabled: number;
  save_every_minutes: number;
  last_restart_slot: string | null;
  last_restart_at: string | null;
  last_save_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  updated_at: string | null;
}

const SCHEDULE_ACTOR: AuditActor = { userId: null, username: 'Schedule' };
export const DEFAULT_RESTART_MESSAGE = 'Scheduled restart in {minutes} minutes. Find a safe spot!';
/** A restart slot the panel missed by more than this (it was down) is skipped, not run late. */
const MISSED_GRACE_MS = 60 * 1000;

export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The restart times of one day, in minutes after midnight: restartAt, then every
 * restartEveryHours until the day ends. An interval that doesn't divide 24 starts
 * over from restartAt the next day.
 */
export function restartMinutes(everyHours: number, at: string): number[] {
  const anchor = Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5));
  const step = everyHours * 60;
  const times = new Set<number>();
  for (let offset = 0; offset < 24 * 60; offset += step) times.add((anchor + offset) % (24 * 60));
  return [...times].sort((a, b) => a - b);
}

/** The next restart strictly after `after`, in local time. */
export function nextRestart(everyHours: number, at: string, after: Date): Date {
  const minutes = restartMinutes(everyHours, at);
  for (let day = 0; day <= 1; day++) {
    for (const minute of minutes) {
      const candidate = new Date(after.getFullYear(), after.getMonth(), after.getDate() + day, 0, minute);
      if (candidate > after) return candidate;
    }
  }
  // Unreachable: every day has at least one restart time.
  throw new Error('No restart time found');
}

/**
 * Scheduled world saves and restarts, driven by the panel through the REST API.
 * A restart is the game's own graceful shutdown with a countdown; the server's
 * service manager (e.g. Docker's restart policy) has to start it again.
 */
export class ScheduleService {
  private nextSaveAt: number | undefined;
  private busy = false;

  constructor(
    private readonly db: DB,
    private readonly palworld: PalworldService,
    private readonly servers: ServerRegistry,
    private readonly audit: AuditLog,
    private readonly console: ConsoleService,
  ) {}

  getSettings(): ScheduleSettings {
    const r = this.row();
    return {
      restartEnabled: !!r.restart_enabled,
      restartEveryHours: r.restart_every_hours,
      restartAt: r.restart_at,
      restartWarnMinutes: r.restart_warn_minutes,
      restartMessage: r.restart_message,
      saveEnabled: !!r.save_enabled,
      saveEveryMinutes: r.save_every_minutes,
      updatedAt: r.updated_at,
    };
  }

  saveSettings(input: ScheduleSettingsInput, now = new Date()): ScheduleSettings {
    this.db
      .prepare(
        `UPDATE server_schedule SET restart_enabled = ?, restart_every_hours = ?, restart_at = ?, restart_warn_minutes = ?,
           restart_message = ?, save_enabled = ?, save_every_minutes = ?, updated_at = ? WHERE id = 1`,
      )
      .run(
        input.restartEnabled ? 1 : 0,
        input.restartEveryHours,
        input.restartAt,
        input.restartWarnMinutes,
        input.restartMessage,
        input.saveEnabled ? 1 : 0,
        input.saveEveryMinutes,
        now.toISOString(),
      );
    this.nextSaveAt = undefined;
    return this.getSettings();
  }

  getStatus(now = new Date()): ScheduleStatus {
    const r = this.row();
    const s = this.getSettings();
    return {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      nextRestartAt: s.restartEnabled ? nextRestart(s.restartEveryHours, s.restartAt, now).toISOString() : null,
      nextSaveAt: s.saveEnabled ? new Date(this.nextSaveAt ?? now.getTime() + s.saveEveryMinutes * 60_000).toISOString() : null,
      lastRestartAt: r.last_restart_at,
      lastSaveAt: r.last_save_at,
      lastError: r.last_error && r.last_error_at ? { at: r.last_error_at, message: r.last_error } : null,
    };
  }

  /** Called every few seconds. Starts at most one save or restart at a time. */
  async tick(now = new Date()): Promise<void> {
    if (this.busy || !this.servers.getPrimary()) return;
    this.busy = true;
    try {
      const s = this.getSettings();
      if (s.restartEnabled && (await this.maybeRestart(s, now))) return;
      if (s.saveEnabled) await this.maybeSave(s, now);
    } finally {
      this.busy = false;
    }
  }

  private async maybeRestart(s: ScheduleSettings, now: Date): Promise<boolean> {
    // The slot due next, looked up from just before its warning window, so the
    // countdown starts on time and a slot that just passed is still found.
    const warnMs = s.restartWarnMinutes * 60_000;
    const slot = nextRestart(s.restartEveryHours, s.restartAt, new Date(now.getTime() - MISSED_GRACE_MS));
    const slotKey = slot.toISOString();
    if (now.getTime() < slot.getTime() - warnMs || this.row().last_restart_slot === slotKey) return false;

    // Claim the slot first so a failure isn't retried every tick.
    this.db.prepare('UPDATE server_schedule SET last_restart_slot = ? WHERE id = 1').run(slotKey);
    const waitSeconds = Math.max(10, Math.round((slot.getTime() - now.getTime()) / 1000));
    const minutes = Math.max(1, Math.round(waitSeconds / 60));
    const message = (s.restartMessage.trim() || DEFAULT_RESTART_MESSAGE).replaceAll('{minutes}', String(minutes));
    try {
      await this.palworld.save().catch(() => undefined);
      await this.palworld.shutdown(waitSeconds, message);
      this.db.prepare('UPDATE server_schedule SET last_restart_at = ?, last_error = NULL, last_error_at = NULL WHERE id = 1').run(now.toISOString());
      this.audit.record(SCHEDULE_ACTOR, { category: 'server', action: 'scheduled_restart', details: { waitSeconds, message } });
    } catch (err) {
      this.fail(`Scheduled restart skipped: ${describe(err)}`, now);
    }
    return true;
  }

  private async maybeSave(s: ScheduleSettings, now: Date): Promise<void> {
    const interval = s.saveEveryMinutes * 60_000;
    this.nextSaveAt ??= now.getTime() + interval;
    if (now.getTime() < this.nextSaveAt) return;
    this.nextSaveAt = now.getTime() + interval;
    try {
      await this.palworld.save();
      this.db.prepare('UPDATE server_schedule SET last_save_at = ? WHERE id = 1').run(now.toISOString());
    } catch (err) {
      // An offline server is normal (e.g. mid-restart); only report other problems.
      if (!(err instanceof PalworldError && err.code === 'unreachable')) this.fail(`Scheduled save failed: ${describe(err)}`, now);
    }
  }

  private fail(message: string, now: Date): void {
    this.db.prepare('UPDATE server_schedule SET last_error = ?, last_error_at = ? WHERE id = 1').run(message, now.toISOString());
    this.console.add('panel', message, 'warn');
  }

  private row(): Row {
    return this.db.prepare('SELECT * FROM server_schedule WHERE id = 1').get() as Row;
  }
}

const describe = (err: unknown) => (err instanceof Error ? err.message : 'unexpected error');
