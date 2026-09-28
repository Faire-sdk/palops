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
    mockPlayer('Lamball Enjoyer', 'steam_76561190000000001', 32, 'Wool Gatherers'),
    mockPlayer('Anubis', 'steam_76561190000000002', 47, 'Desert Kings'),
    mockPlayer('CattivaFan', 'epic_0f3a9c2b1d', 12, null),
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
    return { ...MOCK_SETTINGS };
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

function mockPlayer(name: string, userId: string, level: number, guild: string | null): PalworldPlayer {
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
    guild,
  };
}

/** A realistic subset of what GET /v1/api/settings returns. */
const MOCK_SETTINGS: PalworldSettings = {
  Difficulty: 'None',
  DayTimeSpeedRate: 1,
  NightTimeSpeedRate: 1,
  ExpRate: 1.5,
  PalCaptureRate: 1.2,
  PalSpawnNumRate: 1,
  PalDamageRateAttack: 1,
  PalDamageRateDefense: 1,
  PlayerDamageRateAttack: 1,
  PlayerDamageRateDefense: 1,
  PlayerStomachDecreaceRate: 1,
  PlayerStaminaDecreaceRate: 1,
  PalStomachDecreaceRate: 1,
  PalEggDefaultHatchingTime: 12,
  WorkSpeedRate: 1,
  CollectionDropRate: 1.5,
  EnemyDropItemRate: 1,
  DeathPenalty: 'Item',
  BaseCampMaxNum: 128,
  BaseCampWorkerMaxNum: 15,
  GuildPlayerMaxNum: 20,
  bEnablePlayerToPlayerDamage: false,
  bEnableFriendlyFire: false,
  bEnableInvaderEnemy: true,
  bIsPvP: false,
  bEnableFastTravel: true,
  bExistPlayerAfterLogout: false,
  bShowPlayerList: true,
  ServerName: 'Mock Palworld Server',
  ServerDescription: 'Development server',
  ServerPlayerMaxNum: 32,
  CoopPlayerMaxNum: 4,
  PublicPort: 8211,
  PublicIP: '',
  Region: '',
  bUseAuth: true,
  BanListURL: 'https://api.palworldgame.com/api/banlist.txt',
  RCONEnabled: false,
  RCONPort: 25575,
  RESTAPIEnabled: true,
  RESTAPIPort: 8212,
  AllowConnectPlatform: 'Steam',
  bIsUseBackupSaveData: true,
  LogFormatType: 'Text',
};
