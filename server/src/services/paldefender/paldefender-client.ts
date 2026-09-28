import { isIPv6 } from 'node:net';

export type PalDefenderErrorCode = 'not_configured' | 'unreachable' | 'unauthorized' | 'missing_permission' | 'not_found' | 'rejected' | 'api_error' | 'invalid_response';

export class PalDefenderError extends Error {
  constructor(
    public readonly code: PalDefenderErrorCode,
    message: string,
    /** PalDefender's own error code, e.g. BAN_NOT_FOUND. */
    public readonly apiCode?: string,
  ) {
    super(message);
  }
}

export interface PalDefenderConnection {
  host: string;
  port: number;
  useTls: boolean;
  token: string;
  timeoutMs?: number;
}

export interface PalDefenderPlayer {
  name: string;
  ip: string | null;
  playerUid: string | null;
  userId: string | null;
  guildName: string | null;
  status: string | null;
}

/** One ban from PalDefender's own ban list (Banlist.json). */
export interface PalDefenderBan {
  kind: 'user' | 'ip';
  /** The platform id for user bans, the address for IP bans. */
  id: string;
  active: boolean;
  reason: string | null;
  bannedBy: string | null;
  /** How it was issued, e.g. rest, console, anticheat. */
  bannedVia: string | null;
  bannedAt: string | null;
  unbannedAt: string | null;
}

export interface BanResult {
  kicked: number;
  bannedIp: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});


// ---- Player data (PalDefender only reads players who are online) ----

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface PdPal {
  instanceId: string;
  palId: string;
  nickname: string | null;
  gender: string | null;
  level: number | null;
  shiny: boolean;
  hp: number | null;
  passives: string[];
  activeSkills: string[];
  /** Team, box or base slot, when reported. */
  slot: number | null;
  /** Palbox page. */
  page: number | null;
}

export interface PdPals {
  player: { uid: string | null; name: string | null };
  team: PdPal[];
  palbox: PdPal[];
  baseCamps: Array<{ id: string; level: number | null; state: string | null; mapPos: Point | null; pals: PdPal[] }>;
}

export interface PdContainer {
  /** Items, KeyItems, Weapons, Armor, Food or DropSlot. */
  name: string;
  available: boolean;
  usedSlots: number | null;
  maxSlots: number | null;
  slots: Array<{ slot: number; itemId: string; count: number }>;
}

export interface PdItems {
  player: { uid: string | null; name: string | null };
  containers: PdContainer[];
}

export interface PdTechs {
  player: { uid: string | null; name: string | null };
  unlocked: string[];
  unlockedCount: number;
  lockedCount: number;
  totalCount: number;
}

export interface PdProgression {
  player: { uid: string | null; name: string | null };
  /** PalDefender's progression groups (Player, Currencies, Bosses, Captures, Activities) as reported. */
  progression: Record<string, unknown>;
}

export interface PdGuildSummary {
  id: string;
  name: string;
  level: number | null;
  admin: { id: string; name: string } | null;
  memberCount: number;
  campCount: number;
  members: string[];
  camps: Array<{ id: string; mapPos: Point | null }>;
}

export interface PdGuild {
  name: string;
  level: number | null;
  admin: { id: string; name: string } | null;
  members: Array<{ uid: string; name: string; status: string | null }>;
  camps: Array<{ id: string; level: number | null; state: string | null; mapPos: Point | null }>;
  storage: { used: number; max: number } | null;
  currentResearch: string | null;
}

export interface DeletedBase {
  id: string | null;
  summary: string | null;
  deleted: Record<string, number | boolean>;
  archive: string | null;
}

export type PalMessageType = 'PlayerChat' | 'PlayerGlobalChat' | 'PlayerGuildChat' | 'PlayerLogNormal' | 'PlayerLogImportant' | 'PlayerLogVeryImportant';

export const MESSAGE_PERMISSIONS: Record<PalMessageType, string> = {
  PlayerChat: 'REST.Messages.Send.PlayerChat',
  PlayerGlobalChat: 'REST.Messages.Send.GlobalChat',
  PlayerGuildChat: 'REST.Messages.Send.GuildChat',
  PlayerLogNormal: 'REST.Messages.Send.Log.Normal',
  PlayerLogImportant: 'REST.Messages.Send.Log.Important',
  PlayerLogVeryImportant: 'REST.Messages.Send.Log.VeryImportant',
};

export interface SummonOptions {
  x: number;
  y: number;
  z: number;
  level?: number;
  uncapturable?: boolean;
  disableAi?: boolean;
  disableDamageMeter?: boolean;
  disableStatuses?: string[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const point = (v: unknown): Point | null => {
  const p = obj(v);
  const [x, y, z] = [num(p.x), num(p.y), num(p.z)];
  return x !== null && y !== null ? { x, y, z: z ?? 0 } : null;
};
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const who = (meta: unknown) => ({ uid: str(obj(meta).PlayerUID), name: str(obj(meta).Player) });

function pal(instanceId: string, raw: unknown): PdPal {
  const p = obj(raw);
  return {
    instanceId,
    palId: str(p.PalID) ?? str(p.UniqueNPCID) ?? 'Unknown',
    nickname: str(p.Nickname),
    gender: str(p.Gender),
    level: num(p.Level),
    shiny: p.Shiny === true,
    hp: num(p.HP),
    passives: strings(p.Passives),
    activeSkills: strings(p.ActiveSkills),
    slot: num(p.team_slot_index) ?? num(p.slot) ?? num(p.base_camp_slot_index),
    page: num(p.page),
  };
}
const palMap = (v: unknown): PdPal[] => Object.entries(obj(v)).map(([id, raw]) => pal(id, raw));
const admin = (v: unknown) => {
  const a = obj(v);
  return str(a.id) || str(a.name) ? { id: str(a.id) ?? '', name: str(a.name) ?? '' } : null;
};

/** PalDefender stamps times as UTC seconds; accept milliseconds too. */
function toIso(stamp: unknown): string | null {
  const utc = obj(stamp).UTC;
  if (typeof utc !== 'number' || !Number.isFinite(utc) || utc <= 0) return null;
  return new Date(utc > 1e11 ? utc : utc * 1000).toISOString();
}

/**
 * Client for the PalDefender plugin's REST API (default 127.0.0.1:17993,
 * bearer token). PalDefender is an optional add-on: the panel never needs it.
 * See https://ultimeit.github.io/PalDefender/RESTAPI/
 */
export class PalDefenderClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly connection: PalDefenderConnection) {
    const host = isIPv6(connection.host) ? `[${connection.host}]` : connection.host;
    this.baseUrl = new URL(`${connection.useTls ? 'https' : 'http'}://${host}:${connection.port}/v1/pdapi/`).toString();
    this.timeoutMs = connection.timeoutMs ?? 6000;
  }

  async version(): Promise<string> {
    const body = await this.request('GET', 'version', undefined, 'REST.Version.Read');
    const v = obj(obj(body).Version);
    return str(v.VersionLong) ?? str(v.Version) ?? 'unknown';
  }

  async players(): Promise<PalDefenderPlayer[]> {
    const body = obj(await this.request('GET', 'players', undefined, 'REST.Players.Read'));
    if (!Array.isArray(body.Players)) throw new PalDefenderError('invalid_response', 'PalDefender returned a player list the panel could not read');
    return body.Players.map((raw) => {
      const p = obj(raw);
      return {
        name: str(p.Name) ?? '',
        ip: str(p.IP),
        playerUid: str(p.PlayerUID),
        userId: str(p.UserId),
        guildName: str(p.GuildName),
        status: str(p.Status),
      };
    });
  }

  async banlist(options: { activeOnly?: boolean } = {}): Promise<PalDefenderBan[]> {
    const query = options.activeOnly ? '?active=true' : '';
    const body = obj(obj(await this.request('GET', `banlist${query}`, undefined, 'REST.Banlist.Read')).Banlist);
    const entry = (kind: 'user' | 'ip', raw: unknown): PalDefenderBan | null => {
      const e = obj(raw);
      const id = str(kind === 'user' ? e.UserId : e.IP);
      if (!id) return null;
      const by = obj(e.BannedBy);
      const unbanned = obj(e.UnbannedBy);
      return {
        kind,
        id,
        active: e.Active !== false,
        reason: str(by.Reason),
        bannedBy: str(by.NameValue),
        bannedVia: str(by.Type),
        bannedAt: toIso(by.Timestamp),
        unbannedAt: toIso(unbanned.Timestamp),
      };
    };
    const users = (Array.isArray(body.UserEntries) ? body.UserEntries : []).map((e) => entry('user', e));
    const ips = (Array.isArray(body.IPEntries) ? body.IPEntries : []).map((e) => entry('ip', e));
    return [...users, ...ips].filter((e): e is PalDefenderBan => e !== null);
  }

  async ban(userId: string, options: { reason?: string; ip?: boolean } = {}): Promise<BanResult> {
    const body = obj(await this.request('POST', `ban/${encodeURIComponent(userId)}`, { Reason: options.reason ?? '', IP: !!options.ip }, 'REST.Punishments.Ban'));
    return { kicked: typeof body.Kicked === 'number' ? body.Kicked : 0, bannedIp: str(body.BannedIP) };
  }

  async unban(userId: string, reason = ''): Promise<void> {
    await this.request('POST', `unban/${encodeURIComponent(userId)}`, { Reason: reason }, 'REST.Punishments.Unban');
  }

  async banIp(ip: string, options: { reason?: string; userId?: string | null } = {}): Promise<{ kicked: number }> {
    const body = obj(
      await this.request('POST', `banip/${encodeURIComponent(ip)}`, { Reason: options.reason ?? '', ...(options.userId ? { UserId: options.userId } : {}) }, 'REST.Punishments.BanIP'),
    );
    return { kicked: typeof body.Kicked === 'number' ? body.Kicked : 0 };
  }

  async unbanIp(ip: string, reason = ''): Promise<void> {
    await this.request('POST', `unbanip/${encodeURIComponent(ip)}`, { Reason: reason }, 'REST.Punishments.UnbanIP');
  }

  // ---- Reads (the player must be online) ----

  private async playerRead(kind: 'pals' | 'items' | 'techs' | 'progression', identifier: string, permission: string): Promise<Record<string, unknown>> {
    return obj(await this.request('GET', `${kind}/${encodeURIComponent(identifier)}`, undefined, permission));
  }

  async pals(identifier: string): Promise<PdPals> {
    const body = await this.playerRead('pals', identifier, 'REST.Pals.Read');
    const pals = obj(body.Pals);
    return {
      player: who(body.Meta),
      team: palMap(pals.Team).sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99)),
      palbox: palMap(pals.Palbox).sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (a.slot ?? 0) - (b.slot ?? 0)),
      baseCamps: (Array.isArray(pals.BaseCamps) ? pals.BaseCamps : []).map((raw) => {
        const c = obj(raw);
        return { id: str(c.id) ?? '', level: num(c.level), state: str(c.state), mapPos: point(c.map_pos), pals: palMap(c.pals) };
      }),
    };
  }

  async items(identifier: string): Promise<PdItems> {
    const body = await this.playerRead('items', identifier, 'REST.Items.Read');
    const inventory = obj(body.Inventory);
    return {
      player: who(body.Meta),
      containers: Object.entries(inventory).map(([name, raw]) => {
        const c = obj(raw);
        return {
          name,
          available: c.Available !== false,
          usedSlots: num(c.UsedSlots),
          maxSlots: num(c.MaxSlots),
          slots: Object.entries(obj(c.Slots))
            .map(([index, slot]) => ({ slot: Number(index), itemId: str(obj(slot).ItemID) ?? '', count: num(obj(slot).Count) ?? 0 }))
            .filter((s) => s.itemId !== '' && Number.isFinite(s.slot))
            .sort((a, b) => a.slot - b.slot),
        };
      }),
    };
  }

  async techs(identifier: string): Promise<PdTechs> {
    const body = await this.playerRead('techs', identifier, 'REST.Techs.Read');
    const meta = obj(body.Meta);
    const unlocked = strings(obj(body.Techs).Unlocked);
    return {
      player: who(meta),
      unlocked,
      unlockedCount: num(meta.UnlockedCount) ?? unlocked.length,
      lockedCount: num(meta.LockedCount) ?? 0,
      totalCount: num(meta.TotalCount) ?? unlocked.length,
    };
  }

  async progression(identifier: string): Promise<PdProgression> {
    const body = await this.playerRead('progression', identifier, 'REST.Progression.Read');
    return { player: who(body.Meta), progression: obj(body.Progression) };
  }

  async guilds(): Promise<PdGuildSummary[]> {
    const body = obj(await this.request('GET', 'guilds', undefined, 'REST.Guilds.Read'));
    return Object.entries(obj(body.Guilds)).map(([id, raw]) => {
      const g = obj(raw);
      const camps = Array.isArray(g.camps) ? g.camps : [];
      return {
        id,
        name: str(g.name) ?? id,
        level: num(g.Level),
        admin: admin(g.admin),
        memberCount: num(g.member_count) ?? strings(g.members).length,
        campCount: num(g.camp_count) ?? camps.length,
        members: strings(g.members),
        camps: camps.map((c) => ({ id: str(obj(c).id) ?? '', mapPos: point(obj(c).map_pos) })),
      };
    });
  }

  async guild(guildId: string): Promise<PdGuild> {
    const g = obj(obj(await this.request('GET', `guild/${encodeURIComponent(guildId)}`, undefined, 'REST.Guild.Read')).Guild);
    const items = obj(g.items);
    return {
      name: str(g.name) ?? guildId,
      level: num(g.Level),
      admin: admin(g.admin),
      members: (Array.isArray(g.members) ? g.members : []).map((m) => ({ uid: str(obj(m).player_uid) ?? '', name: str(obj(m).player_name) ?? '', status: str(obj(m).status) })),
      camps: (Array.isArray(g.camps) ? g.camps : []).map((c) => ({ id: str(obj(c).id) ?? '', level: num(obj(c).level), state: str(obj(c).state), mapPos: point(obj(c).map_pos) })),
      storage: num(items.current) !== null && num(items.max) !== null ? { used: num(items.current)!, max: num(items.max)! } : null,
      currentResearch: str(obj(g.laboratory).current_research),
    };
  }

  // ---- Messages ----

  async broadcast(message: string): Promise<void> {
    await this.request('POST', 'Broadcast', { Message: message }, 'REST.Messages.Broadcast');
  }

  /** An on-screen alert for everyone. */
  async alert(message: string): Promise<void> {
    await this.request('POST', 'Alert', { Message: message }, 'REST.Messages.Alert');
  }

  async sendPlayerMessage(type: PalMessageType, message: string, userIds: string[]): Promise<number> {
    const target = userIds.length === 1 ? { UserID: userIds[0] } : { UserIDs: userIds };
    const body = obj(await this.request('POST', 'SendPlayerMessage', { SendType: type, Message: message, ...target }, MESSAGE_PERMISSIONS[type]));
    return num(body.SentCount) ?? userIds.length;
  }

  // ---- Changes to the game world ----

  async giveItems(identifier: string, items: Array<{ itemId: string; count: number }>): Promise<number> {
    const body = obj(await this.post(`give/items/${encodeURIComponent(identifier)}`, { Items: items.map((i) => ({ ItemID: i.itemId, Count: i.count })) }, 'REST.Items.Give'));
    return num(obj(body.Granted).Items) ?? items.length;
  }

  async givePals(identifier: string, pals: Array<{ palId: string; level: number }>): Promise<number> {
    const body = obj(await this.post(`give/pals/${encodeURIComponent(identifier)}`, { Pals: pals.map((p) => ({ PalID: p.palId, Level: p.level })) }, 'REST.Pals.Give'));
    return num(obj(body.Granted).Pals) ?? pals.length;
  }

  async givePalEggs(identifier: string, eggs: Array<{ eggId: string; palId?: string; palTemplate?: string; level?: number }>): Promise<number> {
    const PalEggs = eggs.map((e) => ({ EggID: e.eggId, ...(e.palId ? { PalID: e.palId } : {}), ...(e.palTemplate ? { PalTemplate: e.palTemplate } : {}), ...(e.level ? { Level: e.level } : {}) }));
    const body = obj(await this.post(`give/paleggs/${encodeURIComponent(identifier)}`, { PalEggs }, 'REST.PalEggs.Give'));
    return num(obj(body.Granted).PalEggs) ?? eggs.length;
  }

  async givePalTemplates(identifier: string, templates: string[]): Promise<number> {
    const body = obj(await this.post(`give/paltemplate/${encodeURIComponent(identifier)}`, { PalTemplates: templates }, 'REST.PalTemplates.Give'));
    return num(obj(body.Granted).PalTemplates) ?? templates.length;
  }

  async giveProgression(
    identifier: string,
    grant: { exp?: number; technologyPoints?: number; ancientTechnologyPoints?: number; relics?: Record<string, number> },
  ): Promise<{ granted: Record<string, unknown>; totals: Record<string, unknown> }> {
    const payload = {
      ...(grant.exp ? { EXP: grant.exp } : {}),
      ...(grant.technologyPoints ? { TechnologyPoints: grant.technologyPoints } : {}),
      ...(grant.ancientTechnologyPoints ? { AncientTechnologyPoints: grant.ancientTechnologyPoints } : {}),
      ...(grant.relics && Object.keys(grant.relics).length ? { Relics: grant.relics } : {}),
    };
    const body = obj(await this.post(`give/progression/${encodeURIComponent(identifier)}`, payload, 'REST.Progression.Give'));
    return { granted: obj(body.Granted), totals: obj(body.Totals) };
  }

  async learnTech(identifier: string, technology: string | string[]): Promise<{ unlocked: string[]; skipped: string[] }> {
    const body = obj(await this.post(`learntech/${encodeURIComponent(identifier)}`, { Technology: technology }, 'REST.Techs.Learn'));
    return { unlocked: strings(body.Unlocked), skipped: strings(body.Skipped) };
  }

  async forgetTech(identifier: string, technology: string | string[]): Promise<{ forgotten: string[]; skipped: string[] }> {
    const body = obj(await this.post(`forgettech/${encodeURIComponent(identifier)}`, { Technology: technology }, 'REST.Techs.Forget'));
    return { forgotten: typeof body.Forgotten === 'string' ? [body.Forgotten] : strings(body.Forgotten), skipped: strings(body.Skipped) };
  }

  async summonPal(target: { palId?: string; palTemplate?: string }, o: SummonOptions): Promise<Record<string, unknown>> {
    const body = {
      ...(target.palTemplate ? { PalTemplate: target.palTemplate } : { PalID: target.palId }),
      X: o.x,
      Y: o.y,
      Z: o.z,
      ...(o.level ? { Level: o.level } : {}),
      Uncapturable: !!o.uncapturable,
      DisableAI: !!o.disableAi,
      DisableDamageMeter: !!o.disableDamageMeter,
      ...(o.disableStatuses?.length ? { DisableStatuses: o.disableStatuses } : {}),
    };
    return obj(obj(await this.post('summon/pal', body, 'REST.Summon.Pal')).Summoned);
  }

  async summonNpc(npcId: string, o: SummonOptions): Promise<Record<string, unknown>> {
    const body = { NPCID: npcId, X: o.x, Y: o.y, Z: o.z, ...(o.level ? { Level: o.level } : {}), Uncapturable: !!o.uncapturable, DisableAI: !!o.disableAi };
    return obj(obj(await this.post('summon/npc', body, 'REST.Summon.NPC')).Summoned);
  }

  /** Deletes a base camp with its buildings, storage and pals. PalDefender archives what it removed. */
  async deleteBase(baseCampId: string): Promise<DeletedBase> {
    const body = obj(await this.post(`deletebase/${encodeURIComponent(baseCampId)}`, {}, 'REST.Base.Delete'));
    const deleted: Record<string, number | boolean> = {};
    for (const [k, v] of Object.entries(obj(body.Deleted))) if (typeof v === 'number' || typeof v === 'boolean') deleted[k] = v;
    return { id: str(obj(body.BaseCamp).Id), summary: str(obj(body.BaseCamp).Summary), deleted, archive: str(body.Archive) };
  }

  /** Makes PalDefender re-read its Config.json. */
  async reloadConfig(): Promise<void> {
    await this.request('POST', 'ReloadConfig', {}, 'REST.Reload.Config');
  }

  private post(path: string, body: unknown, permission: string) {
    return this.request('POST', path, body, permission);
  }

  private async request(method: 'GET' | 'POST', path: string, body: unknown, permission: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: {
          Authorization: `Bearer ${this.connection.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw new PalDefenderError('unreachable', timedOut ? 'PalDefender did not respond in time' : 'Could not reach PalDefender. Check the address, port and that its REST API is enabled.');
    }

    const text = await response.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!response.ok) {
      const error = obj(obj(parsed).Error);
      const apiCode = str(error.Code) ?? undefined;
      const apiMessage = str(error.Message)?.slice(0, 200);
      if (response.status === 401) throw new PalDefenderError('unauthorized', 'PalDefender rejected the API token', apiCode);
      if (response.status === 403) throw new PalDefenderError('missing_permission', `The PalDefender token is missing the ${permission} permission`, apiCode);
      if (response.status === 404) throw new PalDefenderError('not_found', apiMessage ?? 'PalDefender could not find that', apiCode);
      // 400s are PalDefender refusing the request (bad item id, no storage space, ...) and say why.
      if (response.status === 400) throw new PalDefenderError('rejected', apiMessage ?? `PalDefender refused the request${apiCode ? ` (${apiCode})` : ''}`, apiCode);
      throw new PalDefenderError('api_error', apiMessage ?? `PalDefender returned HTTP ${response.status}`, apiCode);
    }
    if (parsed === undefined && method === 'GET') throw new PalDefenderError('invalid_response', 'PalDefender returned a response the panel could not read');
    return parsed;
  }
}
