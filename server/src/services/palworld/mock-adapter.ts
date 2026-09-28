import { createHash } from 'node:crypto';
import { PalworldError } from './types.js';
import type { PalworldAdapter, PalworldMetrics, PalworldPlayer, PalworldServerInfo, PalworldSettings } from './types.js';

/**
 * An in-memory fake server so the panel can be developed and demoed without
 * a running Palworld instance. Never used unless selected in settings.
 */
export class MockAdapter implements PalworldAdapter {
  readonly kind = 'mock';
  private startedAt = Date.now();
  private running = true;
  private readonly banned = new Set<string>();
  readonly announcements: string[] = [];
  private players: PalworldPlayer[] = [
    mockPlayer('Lamball Enjoyer', 'steam_76561190000000001', 32),
    mockPlayer('Anubis', 'steam_76561190000000002', 47),
    mockPlayer('CattivaFan', 'epic_0f3a9c2b1d', 12),
  ];

  async getInfo(): Promise<PalworldServerInfo> {
    this.ensureRunning();
    return { name: 'Mock Palworld Server', description: 'Development server', version: 'v0.6.0 (mock)', worldGuid: 'MOCK' };
  }

  async getMetrics(): Promise<PalworldMetrics> {
    this.ensureRunning();
    return {
      fps: 58 + Math.round(Math.random() * 4),
      frameTimeMs: 16.9,
      currentPlayers: this.players.length,
      maxPlayers: 32,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      inGameDays: 42,
      baseCampCount: 7,
    };
  }

  async getPlayers(): Promise<PalworldPlayer[]> {
    this.ensureRunning();
    return this.players.map((p) => ({ ...p }));
  }

  async getSettings(): Promise<PalworldSettings> {
    this.ensureRunning();
    return { ServerName: 'Mock Palworld Server', ServerPlayerMaxNum: 32, ExpRate: 1, PalCaptureRate: 1, bIsPvP: false };
  }

  async announce(message: string) {
    this.ensureRunning();
    this.announcements.push(message);
  }

  async kick(userId: string) {
    this.ensureRunning();
    this.players = this.players.filter((p) => p.userId !== userId);
  }

  async ban(userId: string) {
    this.ensureRunning();
    this.banned.add(userId);
    this.players = this.players.filter((p) => p.userId !== userId);
  }

  async unban(userId: string) {
    this.ensureRunning();
    this.banned.delete(userId);
  }

  async save() {
    this.ensureRunning();
  }

  async shutdown() {
    this.ensureRunning();
    this.running = false;
  }

  async forceStop() {
    this.running = false;
  }

  /** Test/dev helper: bring the fake server back up. */
  start() {
    this.running = true;
    this.startedAt = Date.now();
  }

  private ensureRunning() {
    if (!this.running) throw new PalworldError('unreachable', 'The server is not running');
  }
}

function mockPlayer(name: string, userId: string, level: number): PalworldPlayer {
  return {
    name,
    accountName: name.toLowerCase().replace(/\s+/g, ''),
    playerId: createHash('md5').update(userId).digest('hex').toUpperCase(),
    userId,
    ip: '127.0.0.1',
    ping: 20 + Math.round(Math.random() * 40),
    level,
    location: { x: 1000 * level, y: -500 * level },
    buildingCount: level * 3,
  };
}
