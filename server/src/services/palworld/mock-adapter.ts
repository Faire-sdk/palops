import { createHash } from 'node:crypto';
import { PalworldError } from './types.js';
import { fromMap, type MapPoint } from '../world/map-coords.js';
import type { PalworldAdapter, PalworldMetrics, PalworldPlayer, PalworldServerInfo, PalworldSettings, WorldCharacter, WorldPalBox, WorldSnapshot } from './types.js';

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

  /** Set to false to act like a server started without -enable-gamedata-api. */
  worldEnabled = true;

  async getWorld(): Promise<WorldSnapshot> {
    this.ensureRunning();
    if (!this.worldEnabled) throw new PalworldError('unsupported', 'The server does not offer this endpoint');
    return mockWorld(this.players, (Date.now() - this.startedAt) / 1000);
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

interface MockGuild {
  id: string;
  name: string;
  bases: MapPoint[];
}

const MOCK_GUILDS: Record<string, MockGuild> = {
  'Wool Gatherers': { id: 'G-WOOL', name: 'Wool Gatherers', bases: [{ x: -360, y: -410 }, { x: -120, y: -520 }] },
  'Desert Kings': { id: 'G-DESERT', name: 'Desert Kings', bases: [{ x: 330, y: 250 }] },
  'Cattiva Club': { id: 'G-CATTIVA', name: 'Cattiva Club', bases: [{ x: -520, y: 180 }] },
};

/** Where each mock player hangs out (map coordinates) and which guild they're in. */
const MOCK_HOMES: Record<string, { home: MapPoint; guild: string; ip: string }> = {
  'Lamball Enjoyer': { home: { x: -300, y: -380 }, guild: 'Wool Gatherers', ip: '203.0.113.7' },
  Anubis: { home: { x: 300, y: 230 }, guild: 'Desert Kings', ip: '198.51.100.23' },
  CattivaFan: { home: { x: -500, y: 160 }, guild: 'Cattiva Club', ip: '203.0.113.7' },
};

const SPECIES = ['SheepBall', 'PinkCat', 'ChickenPal', 'Kitsunebi', 'Penguin', 'Anubis', 'Carbunclo', 'Mau', 'Boar', 'Garm', 'WoolFox', 'LizardMan'];
const WORKERS = ['PinkCat', 'Penguin', 'Anubis', 'Carbunclo', 'SheepBall', 'Kitsunebi', 'LizardMan'];

/**
 * A small, believable world: players wander near home with their pal out,
 * bases have worker pals, wild pals cluster in a few areas. Anubis fast-travels
 * across the map every few minutes, and two players share an address, so the
 * cheat signals have something to show.
 */
function mockWorld(players: PalworldPlayer[], seconds: number): WorldSnapshot {
  const rand = seeded(1);
  const characters: WorldCharacter[] = [];
  const palBoxes: WorldPalBox[] = [];
  const at = (p: MapPoint, z = 0) => fromMap(p, z);

  for (const guild of Object.values(MOCK_GUILDS)) {
    guild.bases.forEach((base, b) => {
      palBoxes.push({ guildId: guild.id, guildName: guild.name, location: at(base, 1200) });
      for (let i = 0; i < 4 + ((b + guild.name.length) % 4); i++) {
        const maxHp = 900 + Math.round(rand() * 1200);
        characters.push({
          instanceId: `pal-${guild.id}-${b}-${i}`,
          unitType: 'BaseCampPal',
          name: '',
          className: WORKERS[(i + b) % WORKERS.length] ?? null,
          trainerInstanceId: null,
          userId: null,
          ip: null,
          level: 8 + Math.round(rand() * 30),
          hp: i === 1 ? Math.round(maxHp * 0.2) : maxHp,
          maxHp,
          guildId: guild.id,
          guildName: guild.name,
          location: at({ x: base.x + (rand() - 0.5) * 12, y: base.y + (rand() - 0.5) * 12 }, 1200),
        });
      }
    });
  }

  for (const player of players) {
    const home = MOCK_HOMES[player.name];
    if (!home) continue;
    const guild = MOCK_GUILDS[home.guild];
    if (!guild) continue;
    const angle = seconds / 90 + player.name.length;
    let pos = { x: home.home.x + Math.cos(angle) * 25, y: home.home.y + Math.sin(angle) * 25 };
    if (player.name === 'Anubis' && Math.floor(seconds / 180) % 2 === 1) pos = { x: -150, y: 600 };
    const instanceId = `player-${player.userId}`;
    characters.push({
      instanceId,
      unitType: 'Player',
      name: player.name,
      className: null,
      trainerInstanceId: null,
      userId: player.userId,
      ip: home.ip,
      level: player.level,
      hp: 500,
      maxHp: 500,
      guildId: guild.id,
      guildName: guild.name,
      location: at(pos, 900),
    });
    characters.push({
      instanceId: `otomo-${player.userId}`,
      unitType: 'OtomoPal',
      name: player.name === 'Lamball Enjoyer' ? 'Fluffy' : '',
      className: SPECIES[player.name.length % SPECIES.length] ?? null,
      trainerInstanceId: instanceId,
      userId: null,
      ip: null,
      level: Math.max(1, (player.level ?? 10) - 3),
      hp: 1400,
      maxHp: 1600,
      guildId: guild.id,
      guildName: guild.name,
      location: at({ x: pos.x + 3, y: pos.y + 2 }, 900),
    });
  }

  // Wild pals: a dense cluster near the Desert Kings base (a lag hotspot) and a sparse spread elsewhere.
  const clusters = [
    { center: { x: 360, y: 200 }, count: 140, spread: 60 },
    { center: { x: -250, y: -200 }, count: 40, spread: 250 },
    { center: { x: 100, y: -600 }, count: 30, spread: 200 },
  ];
  let n = 0;
  for (const c of clusters) {
    for (let i = 0; i < c.count; i++) {
      characters.push({
        instanceId: `wild-${n++}`,
        unitType: 'WildPal',
        name: '',
        className: SPECIES[i % SPECIES.length] ?? null,
        trainerInstanceId: null,
        userId: null,
        ip: null,
        level: 1 + Math.round(rand() * 40),
        hp: 800,
        maxHp: 800,
        guildId: null,
        guildName: null,
        location: at({ x: c.center.x + (rand() - 0.5) * c.spread, y: c.center.y + (rand() - 0.5) * c.spread }),
      });
    }
  }
  for (let i = 0; i < 12; i++) {
    characters.push({
      instanceId: `npc-${i}`,
      unitType: 'NPC',
      name: '',
      className: i % 2 ? 'Merchant' : 'PalDealer',
      trainerInstanceId: null,
      userId: null,
      ip: null,
      level: 20,
      hp: 1000,
      maxHp: 1000,
      guildId: null,
      guildName: null,
      location: at({ x: -600 + i * 100, y: 400 - i * 60 }),
    });
  }

  // FPS dips while players are near the crowded area.
  const busy = characters.some((c) => c.unitType === 'Player' && c.guildName === 'Desert Kings');
  const fps = Math.round((busy ? 38 + Math.sin(seconds / 30) * 6 : 58) * 10) / 10;
  return { serverTime: new Date().toISOString().replace('T', ' ').slice(0, 19), fps, averageFps: fps, characters, palBoxes };
}

/** Small deterministic PRNG so the mock world is the same on every call. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
