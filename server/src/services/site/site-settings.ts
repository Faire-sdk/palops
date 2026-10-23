import type { DB } from '../../database/db.js';

export interface SiteSettings {
  /** The public website's server rules, in order. None hides the rules section. */
  rules: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

interface Row {
  rules: string;
  updated_at: string | null;
  updated_by: string | null;
}

/** What staff write for the public website. The join address and Discord invite come from SITE_* variables. */
export class SiteSettingsService {
  constructor(private readonly db: DB) {}

  get(): SiteSettings {
    const r = this.db.prepare(`SELECT rules, updated_at, updated_by FROM site_settings WHERE id = 1`).get() as Row;
    return { rules: parseRules(r.rules), updatedAt: r.updated_at, updatedBy: r.updated_by };
  }

  save(rules: string[], by: string | null, now = new Date()): SiteSettings {
    const clean = rules.map((rule) => rule.trim()).filter(Boolean);
    this.db.prepare(`UPDATE site_settings SET rules = ?, updated_at = ?, updated_by = ? WHERE id = 1`).run(JSON.stringify(clean), now.toISOString(), by);
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
