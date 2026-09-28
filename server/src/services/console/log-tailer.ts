import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { DB } from '../../database/db.js';
import { LOG_EXTENSIONS } from './log-paths.js';

export type ConsoleSourceName = 'panel' | 'game' | 'paldefender';

export interface TailTarget {
  source: ConsoleSourceName;
  /** A log file, or a folder whose recently changed log files are all tailed. */
  path: string;
}

export interface TailStatus {
  source: ConsoleSourceName;
  path: string;
  state: 'watching' | 'missing';
  files: number;
  lastLineAt: string | null;
}

/** On first sight of a file, show roughly this much of its end, so the console isn't empty. */
const BACKFILL_BYTES = 32 * 1024;
const BACKFILL_LINES = 100;
/** If the panel was off for longer than this much log, skip ahead rather than replay it all. */
const MAX_CATCHUP_BYTES = 2 * 1024 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;
const MAX_LINE_CHARS = 2000;
/** In a folder, only files changed in the last day are followed. */
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
const RESCAN_EVERY_POLLS = 5;

/** True for the path itself or anything under it, so /logs doesn't claim /logs2. */
const within = (root: string, path: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

interface Followed {
  path: string;
  source: ConsoleSourceName;
  offset: number;
  /** A partial last line, held until its newline arrives. */
  carry: string;
  /** Decodes UTF-8 across read boundaries, so a character split between two reads isn't corrupted. */
  decoder: StringDecoder;
  /** Started mid-file: the first line is a fragment and is dropped. */
  dropFirst: boolean;
  /** First sight of the file: only its last few lines are shown. */
  backfill: boolean;
}

/**
 * Follows log files like `tail -f`: reads what was appended since the last
 * look, copes with rotation and truncation, remembers where it got to across
 * restarts, and hands whole lines to `emit`. Polling keeps it simple and works
 * the same on Windows, Linux and network shares.
 */
export class LogTailer {
  private timer: NodeJS.Timeout | undefined;
  private targets: TailTarget[] = [];
  private followed = new Map<string, Followed>();
  private polls = 0;
  private lastLineAt = new Map<ConsoleSourceName, string>();
  private status = new Map<string, { state: TailStatus['state']; files: number }>();

  constructor(
    private readonly db: DB,
    private readonly emit: (source: ConsoleSourceName, message: string) => void,
    private readonly intervalMs = 1000,
  ) {}

  start(targets: TailTarget[]): void {
    this.stop();
    this.targets = targets;
    if (targets.length === 0) return;
    this.polls = RESCAN_EVERY_POLLS;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.followed.clear();
    this.status.clear();
    this.targets = [];
  }

  statuses(): TailStatus[] {
    return this.targets.map((t) => ({
      source: t.source,
      path: t.path,
      state: this.status.get(t.path)?.state ?? 'missing',
      files: this.status.get(t.path)?.files ?? 0,
      lastLineAt: this.lastLineAt.get(t.source) ?? null,
    }));
  }

  /** One pass over every target. Public so tests don't have to wait for the timer. */
  poll(): void {
    const rescan = ++this.polls >= RESCAN_EVERY_POLLS;
    if (rescan) this.polls = 0;
    for (const target of this.targets) {
      try {
        // One stat per poll notices a location that has gone away; folders are only re-listed now and then.
        statSync(target.path);
        if (rescan || !this.status.has(target.path) || this.status.get(target.path)?.state === 'missing') this.discover(target);
        this.read(target);
      } catch {
        this.status.set(target.path, { state: 'missing', files: 0 });
        for (const [path, f] of this.followed) if (within(target.path, path) && f.source === target.source) this.followed.delete(path);
      }
    }
  }

  private discover(target: TailTarget): void {
    const info = statSync(target.path);
    const files: string[] = [];
    if (info.isFile()) {
      files.push(target.path);
    } else {
      const now = Date.now();
      const scan = (dir: string, depth: number) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory() && depth < 1) scan(full, depth + 1);
          else if (entry.isFile() && LOG_EXTENSIONS.has(extname(entry.name).toLowerCase()) && !entry.name.startsWith('.')) {
            if (now - statSync(full).mtimeMs <= ACTIVE_WINDOW_MS || this.followed.has(full)) files.push(full);
          }
        }
      };
      scan(target.path, 0);
    }
    for (const path of files) {
      if (!this.followed.has(path)) this.followed.set(path, { path, source: target.source, carry: '', decoder: new StringDecoder('utf8'), ...this.startingPoint(path) });
    }
    // Drop files that vanished (rotated away).
    for (const [path, f] of this.followed) {
      if (f.source !== target.source || files.includes(path)) continue;
      if (within(target.path, path)) this.followed.delete(path);
    }
    this.status.set(target.path, { state: 'watching', files: files.length });
  }

  private startingPoint(path: string): { offset: number; dropFirst: boolean; backfill: boolean } {
    const size = statSync(path).size;
    const saved = this.db.prepare('SELECT offset FROM console_offsets WHERE path = ?').get(path) as { offset: number } | undefined;
    if (saved && saved.offset <= size) {
      // Carry on where we left off, unless that's a long way back: then skip ahead to now.
      return { offset: size - saved.offset <= MAX_CATCHUP_BYTES ? saved.offset : size, dropFirst: false, backfill: false };
    }
    // A file seen for the first time (or one that was replaced): show its recent end.
    return { offset: Math.max(0, size - BACKFILL_BYTES), dropFirst: size > BACKFILL_BYTES, backfill: true };
  }

  private read(target: TailTarget): void {
    for (const f of this.followed.values()) {
      if (f.source !== target.source || !within(target.path, f.path)) continue;
      let size: number;
      try {
        size = statSync(f.path).size;
      } catch {
        this.followed.delete(f.path);
        continue;
      }
      // Rotated or truncated: start again from the top.
      if (size < f.offset) {
        f.offset = 0;
        f.carry = '';
        f.dropFirst = false;
        f.decoder = new StringDecoder('utf8');
      }
      if (size === f.offset) continue;
      let lines = this.readLines(f, size);
      if (f.dropFirst && lines.length > 0) {
        lines = lines.slice(1);
        f.dropFirst = false;
      }
      if (f.backfill) {
        lines = lines.slice(-BACKFILL_LINES);
        f.backfill = false;
      }
      for (const line of lines) this.emitLine(f.source, line);
      this.db
        .prepare(`INSERT INTO console_offsets (path, offset) VALUES (?, ?) ON CONFLICT (path) DO UPDATE SET offset = excluded.offset, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
        .run(f.path, f.offset);
    }
  }

  private readLines(f: Followed, size: number): string[] {
    const fd = openSync(f.path, 'r');
    try {
      const length = Math.min(size - f.offset, READ_CHUNK_BYTES);
      const buffer = Buffer.alloc(length);
      const got = readSync(fd, buffer, 0, length, f.offset);
      f.offset += got;
      const parts = (f.carry + f.decoder.write(buffer.subarray(0, got))).split(/\r?\n/);
      f.carry = parts.pop() ?? '';
      return parts.filter((l) => l.length > 0);
    } finally {
      closeSync(fd);
    }
  }

  private emitLine(source: ConsoleSourceName, line: string): void {
    this.lastLineAt.set(source, new Date().toISOString());
    this.emit(source, line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line);
  }
}
