import type { AdapterKind, ServerConnection, ServerRegistry } from '../servers/server-registry.js';
import { MockAdapter } from './mock-adapter.js';
import { RestApiAdapter } from './rest-api-adapter.js';
import type { PalworldAdapter, PalworldMetrics, PalworldPlayer, PalworldServerInfo } from './types.js';
import { PalworldError } from './types.js';

export type ServerState = 'online' | 'offline' | 'error' | 'unconfigured';

export interface ServerStatus {
  state: ServerState;
  checkedAt: string;
  connection: Pick<ServerConnection, 'name' | 'adapter' | 'host' | 'port'> | null;
  info: PalworldServerInfo | null;
  metrics: PalworldMetrics | null;
  error: { code: string; message: string } | null;
}

export interface AdapterConfig {
  adapter: AdapterKind;
  host: string;
  port: number;
  username: string;
  password: string;
}

const STATUS_CACHE_MS = 2000;

/**
 * The single entry point the rest of the panel uses to talk to Palworld.
 * It picks the right adapter for the configured server and turns transport
 * details into panel-level states and errors.
 */
export class PalworldService {
  private cachedAdapter: { key: string; adapter: PalworldAdapter } | undefined;
  private cachedStatus: { at: number; status: ServerStatus } | undefined;
  /** Shared so the fake server keeps its state across requests. */
  readonly mock = new MockAdapter();

  constructor(private readonly registry: ServerRegistry) {}

  createAdapter(config: AdapterConfig): PalworldAdapter {
    switch (config.adapter) {
      case 'mock':
        return this.mock;
      case 'rest':
        return new RestApiAdapter(config);
    }
  }

  /** Throws PalworldError('not_configured') when no server has been set up yet. */
  adapter(): PalworldAdapter {
    const connection = this.registry.getPrimary();
    if (!connection || (connection.adapter !== 'mock' && !connection.host)) {
      throw new PalworldError('not_configured', 'No Palworld server connection has been configured');
    }
    const key = `${connection.id}:${connection.updatedAt}`;
    if (this.cachedAdapter?.key !== key) {
      this.cachedAdapter = {
        key,
        adapter: this.createAdapter({ ...connection, password: this.registry.getPassword(connection.id) }),
      };
    }
    return this.cachedAdapter.adapter;
  }

  /** Call after the connection settings change. */
  invalidate(): void {
    this.cachedAdapter = undefined;
    this.cachedStatus = undefined;
  }

  async getStatus({ fresh = false } = {}): Promise<ServerStatus> {
    if (!fresh && this.cachedStatus && Date.now() - this.cachedStatus.at < STATUS_CACHE_MS) {
      return this.cachedStatus.status;
    }
    const status = await this.probe();
    this.cachedStatus = { at: Date.now(), status };
    return status;
  }

  /** Checks arbitrary connection settings without saving them. */
  async test(config: AdapterConfig): Promise<ServerStatus> {
    return this.probe(this.createAdapter(config), { name: 'Test', ...config });
  }

  async getPlayers(): Promise<PalworldPlayer[]> {
    return this.adapter().getPlayers();
  }

  async announce(message: string): Promise<void> {
    await this.adapter().announce(message);
  }

  private async probe(adapter?: PalworldAdapter, connection?: ServerStatus['connection']): Promise<ServerStatus> {
    const base = { checkedAt: new Date().toISOString(), info: null, metrics: null, error: null };
    if (!adapter) {
      const primary = this.registry.getPrimary();
      connection = primary ? { name: primary.name, adapter: primary.adapter, host: primary.host, port: primary.port } : null;
      try {
        adapter = this.adapter();
      } catch (err) {
        return { ...base, state: 'unconfigured', connection, error: toStatusError(err) };
      }
    }
    try {
      const [info, metrics] = await Promise.all([adapter.getInfo(), adapter.getMetrics()]);
      return { ...base, state: 'online', connection: connection ?? null, info, metrics };
    } catch (err) {
      const error = toStatusError(err);
      return { ...base, state: error.code === 'unreachable' ? 'offline' : 'error', connection: connection ?? null, error };
    }
  }
}

function toStatusError(err: unknown): { code: string; message: string } {
  if (err instanceof PalworldError) return { code: err.code, message: err.message };
  return { code: 'internal', message: 'Unexpected error while contacting the server' };
}
