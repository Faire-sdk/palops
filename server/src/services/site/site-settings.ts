import type { DB } from '../../database/db.js';

export interface SiteSettings {
  /** The public website's server rules, in order. None hides the rules section. */
  rules: string[];
  /** The server's own colour for its public website (#rrggbb), or null for PalOps blue. */
  accentColor: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type SiteSettingsInput = Partial<Pick<SiteSettings, 'rules' | 'accentColor'>>;

interface Row {
  rules: string;
  accent_color: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** What staff write for the public website. The join address and Discord invite come from SITE_* variables. */
export class SiteSettingsService {
  constructor(private readonly db: DB) {}

  get(): SiteSettings {
    const r = this.db.prepare(`SELECT rules, accent_color, updated_at, updated_by FROM site_settings WHERE id = 1`).get() as Row;
    return { rules: parseRules(r.rules), accentColor: r.accent_color, updatedAt: r.updated_at, updatedBy: r.updated_by };
  }

  /** Saves what's given; anything left out keeps its current value. */
  save(input: SiteSettingsInput, by: string | null, now = new Date()): SiteSettings {
    const current = this.get();
    const rules = (input.rules ?? current.rules).map((rule) => rule.trim()).filter(Boolean);
    const accentColor = input.accentColor === undefined ? current.accentColor : input.accentColor?.toLowerCase() ?? null;
    this.db
      .prepare(`UPDATE site_settings SET rules = ?, accent_color = ?, updated_at = ?, updated_by = ? WHERE id = 1`)
      .run(JSON.stringify(rules), accentColor, now.toISOString(), by);
    return this.get();
  }
}

function parseRules(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
