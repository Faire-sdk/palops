import type { DB } from '../../database/db.js';
import type { SecretBox } from '../../utils/crypto.js';

export const ADAPTER_KINDS = ['rest', 'mock'] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

/** Connection details as they may be shown to a client: never includes the password. */
export interface ServerConnection {
  id: number;
  name: string;
  adapter: AdapterKind;
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
  updatedAt: string;
}

export interface ServerConnectionInput {
  name: string;
  adapter: AdapterKind;
  host: string;
  port: number;
  username: string;
  /** Omit to keep the stored password. */
  password?: string;
}

interface ServerRow {
  id: number;
  name: string;
  adapter: AdapterKind;
  host: string;
  port: number;
  username: string;
  password_encrypted: string | null;
  updated_at: string;
}

const toConnection = (row: ServerRow): ServerConnection => ({
  id: row.id,
  name: row.name,
  adapter: row.adapter,
  host: row.host,
  port: row.port,
  username: row.username,
  hasPassword: row.password_encrypted !== null,
  updatedAt: row.updated_at,
});

/**
 * Stores how to reach each managed Palworld server. Credentials are encrypted
 * at rest and only decrypted inside the Palworld service.
 */
export class ServerRegistry {
  constructor(
    private readonly db: DB,
    private readonly secrets: SecretBox,
  ) {}

  /** The MVP manages one server; this is the seam for multi-server later. */
  getPrimary(): ServerConnection | undefined {
    const row = this.db.prepare('SELECT * FROM servers ORDER BY id LIMIT 1').get() as ServerRow | undefined;
    return row && toConnection(row);
  }

  getPassword(id: number): string {
    const row = this.db.prepare('SELECT password_encrypted FROM servers WHERE id = ?').get(id) as
      | { password_encrypted: string | null }
      | undefined;
    return row?.password_encrypted ? this.secrets.decrypt(row.password_encrypted) : '';
  }

  savePrimary(input: ServerConnectionInput): ServerConnection {
    const existing = this.getPrimary();
    const encrypted = input.password !== undefined ? this.secrets.encrypt(input.password) : undefined;
    if (existing) {
      this.db
        .prepare(
          `UPDATE servers SET name = ?, adapter = ?, host = ?, port = ?, username = ?,
             password_encrypted = COALESCE(?, password_encrypted),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .run(input.name, input.adapter, input.host, input.port, input.username, encrypted ?? null, existing.id);
    } else {
      this.db
        .prepare(
          'INSERT INTO servers (name, adapter, host, port, username, password_encrypted) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(input.name, input.adapter, input.host, input.port, input.username, encrypted ?? null);
    }
    return this.getPrimary()!;
  }
}
