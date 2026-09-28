import type { DB } from '../../database/db.js';
import { badRequest } from '../../utils/errors.js';
import { checkLogPath } from './log-paths.js';
import { LogTailer, type ConsoleSourceName, type TailStatus, type TailTarget } from './log-tailer.js';

export type { ConsoleSourceName } from './log-tailer.js';
export type ConsoleLevel = 'info' | 'warn' | 'error';

export interface ConsoleLine {
  id: number;
  at: string;
  source: ConsoleSourceName;
  level: ConsoleLevel;
  message: string;
}

export interface ConsoleSettings {
  tailEnabled: boolean;
  gameLogPath: string | null;
  paldefenderLogPath: string | null;
  updatedAt: string | null;
}

export interface ConsoleSettingsInput {
  tailEnabled: boolean;
  gameLogPath: string | null;
  paldefenderLogPath: string | null;
}

export interface PathCheck {
  source: 'game' | 'paldefender';
  ok: boolean;
  kind: 'file' | 'directory' | null;
  message: string | null;
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LINES = 100_000;
const MAX_MESSAGE_CHARS = 2000;
const FLUSH_MS = 100;
/** Never let a runaway log fill the queue faster than the database drains it. */
const MAX_QUEUE = 20_000;

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** Terminal colour codes and stray control characters have no place in a web page. */
export const cleanMessage = (raw: string): string => raw.replace(ANSI, '').replace(CONTROL, '').slice(0, MAX_MESSAGE_CHARS);

/** A rough level from the text, for colouring. Log formats differ, so this only looks for the obvious words. */
export function guessLevel(message: string): ConsoleLevel {
  if (/\b(error|fatal|exception|crash(ed)?|failed)\b/i.test(message)) return 'error';
  if (/\bwarn(ing)?\b/i.test(message)) return 'warn';
  return 'info';
}

export interface LineQuery {
  afterId?: number;
  beforeId?: number;
  limit: number;
  sources?: ConsoleSourceName[];
  /** Show this level and above. */
  minLevel?: ConsoleLevel;
  search?: string;
}

const LEVEL_RANK: Record<ConsoleLevel, number> = { info: 0, warn: 1, error: 2 };

/**
 * The panel's console: lines from tailed log files and events the panel knows
 * about (joins, bans, signals, admin actions), kept for a week and streamed to
 * anyone watching. View only: PalOps never sends commands through it.
 */
export class ConsoleService {
  private queue: Array<{ at: string; source: ConsoleSourceName; level: ConsoleLevel; message: string }> = [];
  private timer: NodeJS.Timeout | undefined;
  private listeners = new Set<(lines: ConsoleLine[]) => void>();
  private readonly tailer: LogTailer;

  constructor(
    private readonly db: DB,
    /** Folders the console must never read from (the panel's own data). */
    private readonly protectedDirs: string[],
  ) {
    this.tailer = new LogTailer(db, (source, message) => this.add(source, message));
  }

  add(source: ConsoleSourceName, message: string, level?: ConsoleLevel, at = new Date()): void {
    const text = cleanMessage(message);
    if (!text.trim()) return;
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push({ at: at.toISOString(), source, level: level ?? guessLevel(text), message: text });
    this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
    this.timer.unref();
  }

  /** Writes queued lines and tells live viewers. Called on a short timer and before any read. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    const insert = this.db.prepare('INSERT INTO console_lines (at, source, level, message) VALUES (?, ?, ?, ?)');
    const lines: ConsoleLine[] = [];
    this.db.transaction(() => {
      for (const l of batch) lines.push({ id: Number(insert.run(l.at, l.source, l.level, l.message).lastInsertRowid), ...l });
    })();
    for (const listener of this.listeners) listener(lines);
  }

  /** Called with each batch of new lines. Returns a function that stops listening. */
  subscribe(listener: (lines: ConsoleLine[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Oldest first. With no afterId, the newest `limit` lines. */
  lines(q: LineQuery): ConsoleLine[] {
    this.flush();
    const where: string[] = [];
    const params: Record<string, unknown> = { limit: q.limit };
    if (q.afterId !== undefined) {
      where.push('id > @afterId');
      params.afterId = q.afterId;
    }
    if (q.beforeId !== undefined) {
      where.push('id < @beforeId');
      params.beforeId = q.beforeId;
    }
    if (q.sources?.length) {
      where.push(`source IN (${q.sources.map((_, i) => `@s${i}`).join(', ')})`);
      q.sources.forEach((s, i) => (params[`s${i}`] = s));
    }
    if (q.minLevel && q.minLevel !== 'info') where.push(q.minLevel === 'warn' ? `level IN ('warn', 'error')` : `level = 'error'`);
    if (q.search?.trim()) {
      where.push(String.raw`message LIKE @like ESCAPE '\'`);
      params.like = `%${q.search.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // Following forward reads oldest-first; otherwise take the newest and put them back in order.
    const rows =
      q.afterId !== undefined
        ? (this.db.prepare(`SELECT * FROM console_lines ${clause} ORDER BY id ASC LIMIT @limit`).all(params) as ConsoleLine[])
        : (this.db.prepare(`SELECT * FROM console_lines ${clause} ORDER BY id DESC LIMIT @limit`).all(params) as ConsoleLine[]).reverse();
    return rows;
  }

  /** Drops lines older than a week and anything beyond the newest 100,000. */
  prune(): void {
    this.flush();
    this.db.prepare('DELETE FROM console_lines WHERE at < ?').run(new Date(Date.now() - RETENTION_MS).toISOString());
    this.db.prepare('DELETE FROM console_lines WHERE id <= (SELECT MAX(id) FROM console_lines) - ?').run(MAX_LINES);
  }

  // ---- Log file tailing ----

  settings(): ConsoleSettings {
    const row = this.db.prepare('SELECT * FROM console_settings WHERE id = 1').get() as
      | { tail_enabled: number; game_log_path: string | null; paldefender_log_path: string | null; updated_at: string }
      | undefined;
    return {
      tailEnabled: row?.tail_enabled === 1,
      gameLogPath: row?.game_log_path ?? null,
      paldefenderLogPath: row?.paldefender_log_path ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  }

  /** Checks each configured path without saving anything. */
  check(input: Pick<ConsoleSettingsInput, 'gameLogPath' | 'paldefenderLogPath'>): PathCheck[] {
    const results: PathCheck[] = [];
    for (const [source, path] of [['game', input.gameLogPath], ['paldefender', input.paldefenderLogPath]] as const) {
      if (!path?.trim()) continue;
      try {
        results.push({ source, ok: true, kind: checkLogPath(path, this.protectedDirs).kind, message: null });
      } catch (err) {
        results.push({ source, ok: false, kind: null, message: err instanceof Error ? err.message : 'Invalid path' });
      }
    }
    return results;
  }

  save(input: ConsoleSettingsInput): ConsoleSettings {
    const game = input.gameLogPath?.trim() || null;
    const pd = input.paldefenderLogPath?.trim() || null;
    if (input.tailEnabled && !game && !pd) throw badRequest('Enter at least one log location to switch tailing on', 'path_required');
    // A path that can't be read is refused, so a typo doesn't silently show nothing.
    const failed = this.check({ gameLogPath: game, paldefenderLogPath: pd }).find((c) => !c.ok);
    if (failed) throw badRequest(`${failed.source === 'game' ? 'Game log' : 'PalDefender log'}: ${failed.message}`, 'invalid_path');
    this.db
      .prepare(
        `INSERT INTO console_settings (id, tail_enabled, game_log_path, paldefender_log_path) VALUES (1, @enabled, @game, @pd)
         ON CONFLICT (id) DO UPDATE SET tail_enabled = @enabled, game_log_path = @game, paldefender_log_path = @pd, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run({ enabled: input.tailEnabled ? 1 : 0, game, pd });
    this.restartTail();
    return this.settings();
  }

  /** Starts (or restarts) following the configured files. Safe to call when tailing is off. */
  restartTail(): void {
    const s = this.settings();
    const targets: TailTarget[] = [];
    if (s.tailEnabled) {
      for (const [source, path] of [['game', s.gameLogPath], ['paldefender', s.paldefenderLogPath]] as const) {
        if (!path) continue;
        try {
          targets.push({ source, path: checkLogPath(path, this.protectedDirs).path });
        } catch {
          // The location has gone away since it was saved; the status shows it as missing.
          targets.push({ source, path });
        }
      }
    }
    this.tailer.start(targets);
  }

  stopTail(): void {
    this.tailer.stop();
  }

  tailStatus(): TailStatus[] {
    return this.tailer.statuses();
  }

  /** For tests: read the tailed files now instead of waiting for the timer. */
  pollTail(): void {
    this.tailer.poll();
    this.flush();
  }
}
